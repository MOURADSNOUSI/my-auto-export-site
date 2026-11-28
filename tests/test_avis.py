"""Tests des avis clients (migration 0025, worker/avis.js) : droit à un avis (véhicule remis ou mandat livré), dépôt et
modification par le client, modération dans /admin, affichage sur l'accueil seulement après publication, formulaire de
l'espace acheteur sur téléphone.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_avis
Ignorés si la variable WRANGLER n'est pas définie.
"""
import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
TEXTE = "Suivi sérieux, voiture conforme à l'annonce et bien reçue à Tunis."


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class AvisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--port", str(port), "--persist-to", cls.persist, "-c", cls.config],
                                       cwd=PROJET, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(90):
            try:
                urllib.request.urlopen(cls.base + "/", timeout=2)
                break
            except OSError:
                time.sleep(1)
        else:
            cls.serveur.terminate()
            raise RuntimeError("wrangler dev n'a pas démarré")
        cls.admin = cls.compte("admin@ex.com", "Admin Test", "10.0.1.1")
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.admin = cls.connexion("admin@ex.com")
        cls.client = cls.compte("sami@ex.com", "sami ben ali", "10.0.1.2")
        cls.autre = cls.compte("autre@ex.com", "Autre Client", "10.0.1.3")
        sami = cls.sql("SELECT id FROM users WHERE email = 'sami@ex.com'")[0]["id"]
        autre = cls.sql("SELECT id FROM users WHERE email = 'autre@ex.com'")[0]["id"]
        cls.sql(f"""INSERT INTO customer_vehicles (user_id, reference, make, model, trim, status, purchased_at) VALUES
            ({sami}, 'AV-REMIS', 'Peugeot', '208', 'GT', 'picked_up', '2026-10-01'),
            ({sami}, 'AV-ACHETE', 'Renault', 'Clio', NULL, 'purchased', '2026-11-01'),
            ({autre}, 'AV-AUTRE', 'Kia', 'Ceed', NULL, 'picked_up', '2026-10-02')""")
        cls.sql(f"""INSERT INTO mandats (user_id, reference, public, devise, prix_max, telephone, textes_acceptes, accepte_le, statut, cree_le, mis_a_jour)
            VALUES ({sami}, 'AV-MANDAT', 'tre', 'EUR', 15000, '+21612345678', '{{}}', '2026-09-01', 'livre', '2026-09-01', '2026-10-15')""")
        cls.ids = {r["reference"]: r["id"] for r in cls.sql("SELECT id, reference FROM customer_vehicles")}
        cls.mandat = cls.sql("SELECT id FROM mandats WHERE reference = 'AV-MANDAT'")[0]["id"]
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def api(cls, chemin, data=None, method=None, cookie=None, ip="10.0.0.9"):
        headers = {"Origin": cls.base, "CF-Connecting-IP": ip}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null")
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null")

    @classmethod
    def compte(cls, email, nom, ip):
        statut, data = cls.api("/api/register", {"name": nom, "email": email, "password": MOT_DE_PASSE}, "POST", ip=ip)
        assert statut == 201, (statut, data)
        return cls.connexion(email)

    @classmethod
    def connexion(cls, email):
        requete = urllib.request.Request(cls.base + "/api/login", data=json.dumps({"email": email, "password": MOT_DE_PASSE}).encode(), method="POST",
                                         headers={"Origin": cls.base, "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0.8"})
        with urllib.request.urlopen(requete) as reponse:
            return reponse.headers["Set-Cookie"].split(";")[0]

    def accueil(self):
        with urllib.request.urlopen(urllib.request.Request(self.base + "/", headers={"Accept": "text/html"})) as reponse:
            return reponse.read().decode()

    def deposer(self, source, source_id, cookie=None, **champs):
        corps = {"note": 5, "texte": TEXTE, "nomAffiche": "Sami B.", "consentement": True, **champs}
        return self.api(f"/api/avis/{source}/{source_id}", corps, "PUT", cookie or self.client)

    def decider(self, avis_id, decision, motif=""):
        return self.api(f"/api/admin/avis/{avis_id}/{decision}", {"motif": motif}, "POST", self.admin)

    def avis_id(self, reference):
        return self.sql(f"SELECT id FROM avis_clients WHERE reference = '{reference}'")[0]["id"]

    def test_1_droits_et_validation(self):
        self.assertEqual(self.api("/api/avis")[0], 401)
        statut, data = self.api("/api/avis", cookie=self.client)
        self.assertEqual(statut, 200)
        self.assertEqual(data["nomParDefaut"], "Sami B.")
        # Véhicule remis et mandat livré ; pas le véhicule seulement acheté.
        self.assertEqual(sorted((a["source"], a["reference"], a["vehicule"]) for a in data["achats"]),
                         [("mandat", "AV-MANDAT", ""), ("vehicule", "AV-REMIS", "Peugeot 208 GT")])
        self.assertTrue(all(a["avis"] is None for a in data["achats"]))
        remis = self.ids["AV-REMIS"]
        self.assertEqual(self.deposer("vehicule", remis, consentement=False)[0], 400)
        self.assertEqual(self.deposer("vehicule", remis, note=6)[0], 400)
        self.assertEqual(self.deposer("vehicule", remis, texte="Bien.")[0], 400)
        self.assertEqual(self.deposer("vehicule", remis, nomAffiche="")[0], 400)
        self.assertEqual(self.deposer("vehicule", self.ids["AV-ACHETE"])[0], 404)
        # Le véhicule d'un autre client n'ouvre aucun droit.
        self.assertEqual(self.deposer("vehicule", self.ids["AV-AUTRE"])[0], 404)
        self.assertEqual(self.api("/api/admin/avis", cookie=self.client)[0], 403)
        self.assertEqual(self.api(f"/api/avis/vehicule/{remis}", {"note": 5}, "PUT", self.client, ip="10.0.0.9")[0], 400)

    def test_2_publication_apres_validation(self):
        remis = self.ids["AV-REMIS"]
        statut, data = self.deposer("vehicule", remis, texte=TEXTE + " <script>x</script>", nomAffiche="Sami <b>")
        self.assertEqual(statut, 200, data)
        avis = next(a for a in data["achats"] if a["reference"] == "AV-REMIS")["avis"]
        self.assertEqual(avis["statut"], "en_attente")
        # En attente : rien sur l'accueil.
        self.assertNotIn("Suivi sérieux", self.accueil())
        statut, liste = self.api("/api/admin/avis", cookie=self.admin)
        self.assertEqual(statut, 200)
        self.assertEqual(liste["compteurs"]["en_attente"], 1)
        self.assertEqual(liste["avis"][0]["client"]["email"], "sami@ex.com")
        avis_id = liste["avis"][0]["id"]
        self.assertEqual(self.decider(avis_id, "publier")[0], 200)
        html = self.accueil()
        self.assertIn('<section class="block" id="temoignages" aria-labelledby="temoignages-titre">', html)
        self.assertIn("Suivi sérieux", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn("<script>x</script>", html)
        self.assertIn("Sami &lt;b&gt;, Peugeot 208 GT", html)
        self.assertIn('aria-label="Note : 5 sur 5"', html)
        # Moins de 3 avis publiés : pas de note moyenne.
        self.assertNotIn("Note moyenne", html)
        # Les décisions sont journalisées.
        self.assertTrue(self.sql(f"SELECT id FROM audit_logs WHERE action = 'POST /api/admin/avis/{avis_id}/publier' AND resultat = 'ok'"))
        # Modification par le client : retour en attente, retiré de l'accueil.
        statut, data = self.deposer("vehicule", remis, note=4, texte="Très bon accompagnement, je recommande vivement.")
        self.assertEqual(statut, 200)
        self.assertEqual(next(a for a in data["achats"] if a["reference"] == "AV-REMIS")["avis"]["statut"], "en_attente")
        self.assertNotIn("accompagnement", self.accueil())
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM avis_clients")[0]["n"], 1)

    def test_3_refus_motive_et_moyenne(self):
        statut, _ = self.deposer("mandat", self.mandat, note=2, texte="Délai plus long que prévu mais véhicule reçu.")
        self.assertEqual(statut, 200)
        avis_id = self.avis_id("AV-MANDAT")
        self.assertEqual(self.decider(avis_id, "refuser")[0], 400)
        self.assertEqual(self.decider(avis_id, "refuser", "Contient un numéro de téléphone.")[0], 200)
        self.assertEqual(self.decider(999999, "publier")[0], 404)
        _, data = self.api("/api/avis", cookie=self.client)
        avis = next(a for a in data["achats"] if a["source"] == "mandat")["avis"]
        self.assertEqual((avis["statut"], avis["motifRefus"]), ("refuse", "Contient un numéro de téléphone."))
        self.assertNotIn("Délai plus long", self.accueil())
        # Trois avis publiés : note moyenne affichée.
        statut, _ = self.deposer("vehicule", self.ids["AV-AUTRE"], cookie=self.autre, note=5, nomAffiche="Karim")
        self.assertEqual(statut, 200)
        for reference in ("AV-REMIS", "AV-MANDAT", "AV-AUTRE"):
            self.assertEqual(self.decider(self.avis_id(reference), "publier")[0], 200)
        html = self.accueil()
        self.assertIn("Note moyenne : <strong>3,7 / 5</strong> sur 3 avis", html)
        # Un avis publié peut être retiré du site.
        self.assertEqual(self.decider(self.avis_id("AV-MANDAT"), "refuser", "Retiré à la demande du client.")[0], 200)
        self.assertNotIn("Délai plus long", self.accueil())

    def test_4_formulaire_espace_acheteur_sur_telephone(self):
        contexte = self.browser.new_context(viewport={"width": 390, "height": 844})
        self.addCleanup(contexte.close)
        nom, valeur = self.autre.split("=", 1)
        contexte.add_cookies([{"name": nom, "value": valeur, "url": self.base}])
        self.sql("DELETE FROM avis_clients WHERE reference = 'AV-AUTRE'")
        page = contexte.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(self.base + "/?espace=acheteur")
        page.locator('[data-account-view="avis"]').click()
        formulaire = page.locator(".avis-form")
        formulaire.wait_for()
        self.assertEqual(page.locator('[data-account-view="avis"] span').inner_text(), "1")
        formulaire.locator("button[type=submit]").click()
        self.assertIn("note", formulaire.locator(".avis-message").inner_text())
        formulaire.locator('label[title="4 sur 5"]').click()
        formulaire.locator("textarea").fill("Équipe réactive, véhicule reçu en bon état.")
        formulaire.locator("input[name=consentement]").check()
        formulaire.locator("button[type=submit]").click()
        page.get_by_text("Votre avis sera publié après validation").wait_for()
        self.assertIn("En attente de validation", page.locator("#avis-contenu").inner_text())
        largeur = page.evaluate("document.documentElement.scrollWidth")
        self.assertLessEqual(largeur, 390)
        self.assertEqual(erreurs, [])
        ligne = self.sql("SELECT note, texte, nom_affiche, statut FROM avis_clients WHERE reference = 'AV-AUTRE'")[0]
        self.assertEqual(ligne, {"note": 4, "texte": "Équipe réactive, véhicule reçu en bon état.", "nom_affiche": "Autre C.", "statut": "en_attente"})
        if os.environ.get("AVIS_CAPTURES"):
            page.screenshot(path=os.path.join(os.environ["AVIS_CAPTURES"], "avis-telephone.png"))


if __name__ == "__main__":
    unittest.main()
