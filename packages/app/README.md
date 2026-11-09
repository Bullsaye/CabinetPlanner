# Cabinet Planner app

Web app on top of the engine: cabinet list, inspector with value sources
and formulas, 3D kitchen view, cutlist, part sheets, assembly drawings,
hardware. Saves the project and shop in the browser (localStorage); files
can be opened and saved from the File menu.

```sh
pnpm install
pnpm app              # dev server on http://localhost:5173
pnpm app:build        # production build in packages/app/dist
```

`vite build --mode single` makes one self-contained `index.html`
(`dist-single/`); `node tools/app-artifact.mjs packages/app/dist-single/index.html out.html`
turns it into the page published as a claude.ai artifact.
