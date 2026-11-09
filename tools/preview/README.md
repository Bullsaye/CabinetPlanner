# Preview page

Builds a single HTML page with a 3D view (three.js from a CDN) and the part
drawings of every cabinet in the given projects. Development aid only; the
real app UI comes in phase 2.

```sh
pnpm preview out/preview.html examples/kitchen-basic.project.json reference/cabinets/tall-600-sides-between.project.json
```

The output is a page fragment (no `<html>`/`<body>`), as published to
claude.ai artifacts. Wrap it in a document to open it locally.
