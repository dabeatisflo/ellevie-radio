# ellevie Radio

Een volledig statische Franstalige radiosite, klaar voor GitHub Pages en GitLab Pages.

De website gebruikt alleen HTML, CSS en JavaScript. Er is geen PHP, Node.js-server,
WordPress-installatie of database nodig. De audiostream wordt rechtstreeks geladen via
HTTPS en start pas nadat een bezoeker op **Écouter** klikt, zoals browsers vereisen.

## Projectstructuur

```text
.
├── .github/workflows/pages.yml  # automatische GitHub Pages-publicatie
├── .gitlab-ci.yml               # automatische GitLab Pages-publicatie
├── dist/                        # de volledige publiceerbare website
│   ├── assets/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── README.md
```

Er hoeft niets geïnstalleerd of gebouwd te worden. Open `dist/index.html` om de site
lokaal te bekijken. Alle interne bestanden gebruiken relatieve paden, waardoor de site
ook vanuit een repository-submap blijft werken.

## Publiceren met GitHub Pages

1. Maak een nieuwe GitHub-repository aan. Met GitHub Free moet die publiek zijn voor
   GitHub Pages.
2. Push de volledige inhoud van dit project naar de standaardbranch `main`.
3. Open in GitHub **Settings → Pages** en kies bij **Source** voor **GitHub Actions**.
4. De meegeleverde workflow publiceert bij iedere push naar `main` automatisch de map
   `dist`.

De voortgang is zichtbaar onder **Actions**. De uiteindelijke URL verschijnt bij de
deployment en onder **Settings → Pages**.

Officiële handleiding: [GitHub Pages – publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Publiceren met GitLab Pages

1. Maak een nieuw GitLab-project aan en push de volledige projectinhoud naar de
   standaardbranch.
2. GitLab leest automatisch `.gitlab-ci.yml` en publiceert de map `dist`.
3. Volg de pipeline onder **Build → Pipelines**.
4. Na een geslaagde pipeline staat het webadres onder **Deploy → Pages**.

De configuratie gebruikt de actuele GitLab Pages-syntaxis met `pages.publish: dist`.

Officiële handleiding: [GitLab Pages – plain HTML](https://docs.gitlab.com/user/project/pages/getting_started/pages_from_scratch/)

## Aanpassen

- Pagina-inhoud en streamadres: `dist/index.html`
- Programmaschema en playergedrag: `dist/app.js`
- Vormgeving en responsive ontwerp: `dist/styles.css`
- Logo's en foto's: `dist/assets/`

Huidige stream:
`https://stream.zeno.fm/5ct6gd3f0rhvv`

Gebruik voor een eigen domeinnaam later de domeininstellingen van GitHub Pages of
GitLab Pages. Voeg pas daarna de DNS-records toe die het gekozen platform opgeeft.
