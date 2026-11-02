"""Crée un compte administrateur (ou redonne l'accès admin et un nouveau mot de passe à un compte existant).

Lancement, depuis le dossier du site :
  python3 scripts/creer_admin.py --email admin@exemple.com --nom "Prénom Nom"

Le mot de passe est demandé dans le terminal (rien ne s'affiche à la saisie). Seule son empreinte PBKDF2,
calculée comme le fait le Worker, est envoyée à la base D1 de production via `npx wrangler d1 execute`.
"""
import argparse
import getpass
import hashlib
import re
import secrets
import subprocess
import sys

PBKDF2_ITERATIONS = 100_000  # identique à worker/index.js


def empreinte(mot_de_passe, salt_hex):
    return hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ITERATIONS, 32).hex()


def sql_texte(valeur):
    return "'" + valeur.replace("'", "''") + "'"


def requete_sql(email, nom, mot_de_passe):
    salt = secrets.token_hex(16)
    hash_ = empreinte(mot_de_passe, salt)
    return (
        "INSERT INTO users (email, name, password_hash, password_salt, role) "
        f"VALUES ({sql_texte(email)}, {sql_texte(nom)}, '{hash_}', '{salt}', 'admin') "
        "ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, "
        "password_salt = excluded.password_salt, role = 'admin'; "
        f"DELETE FROM login_failures WHERE email = {sql_texte(email)}; "
        f"DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = {sql_texte(email)}); "
        # Accès donnés à Claude (MCP) : révoqués aussi, au cas où le mot de passe aurait fuité.
        f"DELETE FROM oauth_tokens WHERE user_id = (SELECT id FROM users WHERE email = {sql_texte(email)}); "
        f"DELETE FROM oauth_codes WHERE user_id = (SELECT id FROM users WHERE email = {sql_texte(email)});"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Crée ou réinitialise un compte administrateur M&Y AUTO EXPORT.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--nom", required=True, help="nom affiché, ex. « Snoussi »")
    parser.add_argument("--wrangler", default="npx wrangler", help=argparse.SUPPRESS)
    parser.add_argument("--wrangler-args", default="--remote", help=argparse.SUPPRESS)  # tests : --local --persist-to …
    args = parser.parse_args(argv)

    email = args.email.strip().lower()
    nom = args.nom.strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        parser.error("adresse e-mail invalide")
    if not 2 <= len(nom) <= 80:
        parser.error("le nom doit faire entre 2 et 80 caractères")

    mot_de_passe = getpass.getpass("Mot de passe (12 caractères minimum) : ")
    if len(mot_de_passe) < 12:
        parser.error("mot de passe trop court : 12 caractères minimum pour un compte administrateur")
    if mot_de_passe.lower() in {"admin", "administrateur", "motdepasse", "password", "123456789012"} or mot_de_passe.lower() == email:
        parser.error("mot de passe trop facile à deviner")
    if getpass.getpass("Confirme le mot de passe : ") != mot_de_passe:
        parser.error("les deux mots de passe sont différents")

    commande = args.wrangler.split() + ["d1", "execute", "DB", *args.wrangler_args.split(), "--command", requete_sql(email, nom, mot_de_passe)]
    if subprocess.run(commande).returncode != 0:
        print("Échec : vérifie que tu es connecté (npx wrangler whoami) et que les migrations sont appliquées.", file=sys.stderr)
        return 1
    print(f"\nCompte administrateur prêt : {email}. Connecte-toi sur https://www.myautoexport.com/admin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
