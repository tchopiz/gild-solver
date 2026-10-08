# Guide d'utilisation — GILD Solver (français)

Version française du guide. Le README principal est en anglais.

## Demarrage

Double-clique sur `bin\start-gild.bat`, ou :

```powershell
cd GILD-Solver
npm start
```

Le banner anime s'affiche, un Chrome headless demarre, et le serveur ecoute
sur **http://localhost:47613**.

## Obtenir un token

```powershell
curl.exe -X POST http://localhost:47613/gild/token -H "Content-Type: application/json" -d "{""sitekey"":""TON_SITEKEY"",""target"":""https://le-site.com"",""action"":""login""}"
```

- `sitekey` : la cle reCAPTCHA v3 du site vise (le domaine doit correspondre)
- `target`  : l'URL de ce site
- `action`  : `login`, `verify`, `homepage`... (ce que le site attend)
- `enterprise` : `true` pour reCAPTCHA Enterprise

Reponse : `{ "token": "03AFcW...", "ms": 1357, "browser": 1, "uses": 1 }`

Un token vit ~2 minutes et ne peut etre verifie qu'une seule fois, par le
site proprietaire de la cle (via son secret).

## Endpoints

| Methode | Chemin        | Role                                    |
|---------|---------------|------------------------------------------|
| POST    | `/gild/token` | Generer un token (principal)             |
| POST    | `/gild`       | Pareil que `/gild/token`                 |
| GET     | `/health`     | Etat rapide de la flotte                 |
| GET     | `/stats`      | Compteurs + etat detaille des navigateurs |

## Batch (plusieurs tokens)

```powershell
$env:SITEKEY = "6L..."
$env:TARGET  = "https://le-site.com"
node src\gild-batch.mjs 20 5
```

- `20` = nombre de tokens, `5` = en parallele
- Resultat sauvegarde dans `tokens.txt` (un token par ligne)
- Sans proxy : reste a 3-4 en parallele. Avec proxys : 8-10.

## Proxys

Dans le `.env` :

```
USE_PROXIES=on
PROXIES=1.2.3.4:8080:user:pass,5.6.7.8:8080:user2:pass2
```

ou un fichier `proxies.txt` (un proxy par ligne, memes formats).

- Rotation round-robin automatique
- Un proxy qui rate 2 lancements est mis en pause 2 minutes
- Avec proxys ON : recyclage apres 9 tokens (au lieu de 18)
- Si tous les proxys sont morts, le solveur refuse de sortir sur ton IP reelle

## Configuration (.env)

| Variable            | Defaut | Role                                          |
|---------------------|--------|-----------------------------------------------|
| `PORT`              | 47613  | Port du serveur                               |
| `BROWSERS`          | 4      | Navigateurs Chrome dans le pool               |
| `TABS`              | 1      | Onglets prechauffes par navigateur            |
| `MAX_BROWSERS`      | 16     | Plafond global                                |
| `MINTS_PER_BROWSER` | 18     | Tokens avant auto-fresh du navigateur         |
| `WARMUP`            | 0      | Laisser a 0 (consomme le premier token utile) |
| `HEADLESS`          | 1      | 0 = voir les Chrome travailler                |
| `DEBUG`             | 0      | 1 = logs detailles pas a pas                  |
| `BUFFER_SIZE`       | 0      | >0 = pre-generate des tokens (reponses instant) |
| `CHROME_BIN`        | auto   | Chemin de Chrome si non detecte               |
| `ROLLING`           | 1      | Remplacement a chaud des navigateurs uses     |

## Problemes connus

| Probleme | Solution |
|---|---|
| `port deja pris` | Une autre instance tourne : `netstat -ano \| findstr :47613` puis `taskkill /PID <pid> /F` |
| `pas de token recu` | Mets `WARMUP=0` — le warm-up consomme le premier token utilisable |
| `Invalid site key` | Ta cle n'est pas une v3, ou le domaine ne correspond pas au `target` |
| `invalid-input-response` | Token expire (2 min), deja utilise, ou cle non-v3 |
| Chrome introuvable | Renseigne `CHROME_BIN` dans le `.env` |

## Arret

`Ctrl+C` dans la fenetre du serveur (tue proprement tous les Chrome).
