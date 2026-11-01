
# Instructions communes aux agents IA

## Projet
Application M&Y AUTO EXPORT.

## Agents
- GitHub Copilot : cadrage, triage, coordination et synchronisation des tâches.
- OpenAI Codex : implémentation et exécution des tests.
- Claude Code : audit, revue de code et signalement des risques.
- Un seul agent est responsable d'une tâche à la fois ; les autres interviennent sur des tâches distinctes ou en revue.

## Règles de collaboration
1. Lire `AGENTS.md`, `CLAUDE.md` s'il existe, et `TASKS.md` avant toute tâche.
2. Sur un dépôt connecté à GitHub, les issues sont la source de vérité pour le périmètre, le responsable et l'état ; `TASKS.md` est un index local de liens et un compte rendu, pas une source concurrente.
3. Vérifier `git status` et la branche avant toute modification. Ne pas écraser, réinitialiser, déplacer ou incorporer le travail local d'un autre agent.
4. Utiliser une branche dédiée par issue/tâche, créée depuis la branche de base appropriée ; ne pas partager une branche entre tâches. Si l'arbre de travail contient des changements qui empêchent cette séparation, ne pas les déplacer ni les committer : signaler le blocage.
5. Si aucune issue n'existe pour une tâche sur un dépôt connecté, la faire créer/valider par la personne responsable avant de commencer l'implémentation. Ne pas créer d'issue, branche distante, commit ou pull request sans autorisation.
6. Après chaque intervention, mettre à jour l'issue lorsqu'elle existe et `TASKS.md` : statut, agent responsable, branche, fichiers modifiés, tests exécutés et résultat, ainsi que les blocages. Ne pas prétendre avoir exécuté un test qui ne l'a pas été.
7. Exécuter les tests pertinents après modification et rapporter explicitement ceux qui n'ont pas pu être lancés.
8. Ne jamais déployer, publier ou effectuer une action externe sans validation explicite de l'utilisateur.
9. Ne jamais exposer de secrets ou de clés API ; ne pas les ajouter aux instructions, issues ou comptes rendus.

## Contexte des dépôts
- Ce dépôt (`my-auto-export-site`) contient le Worker Cloudflare, le catalogue, les migrations et les tests du site.
- Le dépôt d'automatisation `my-auto-agent` est distinct et possède ses propres instructions, son suivi et ses issues. Ne pas modifier cet autre dépôt dans le cadre d'une issue de celui-ci sans l'indiquer explicitement.
- Les fichiers de coordination peuvent être non suivis localement ; les préserver et vérifier leur état avant toute opération Git.
