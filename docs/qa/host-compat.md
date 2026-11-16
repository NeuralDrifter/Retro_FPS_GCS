# Host compatibility (release plan P3.8)

The same exported zip must run, unchanged, on three free static hosts. This page records each
check. Repeat it before each release, and whenever the export's file layout or the runtime changes.

## Limits the editor warns about

`src/export/hostLimits.ts` holds the limits. After an export, the "Game exported" panel and the
event log list every limit the game passes. Recheck the numbers against each host's documentation
before a release, and update the file and this table together.

| Host | Files | Per file | Total (unzipped) | Source |
|---|---|---|---|---|
| itch.io | 1,000 | 200 MB | 500 MB | itch.io's HTML5 upload documentation; recheck before release |
| GitHub Pages | none | 100 MB | 1 GB | GitHub's limits for repositories and for Pages sites |

The proving-grounds sample is far below every limit.

## Procedure

1. Open the editor, choose File > New from Sample, and click Export Game. Note the SHA-256 the
   "Game exported" panel shows, and keep the zip.
2. **itch.io:** create a draft project (Kind of project: HTML). Upload the zip as is, tick "This
   file will be played in the browser", set the viewport to 1280 x 720, and turn on the fullscreen
   button. Keep the project as a draft and open it from its draft link.
3. **GitHub Pages:** create a test repository, add the unzipped files at its root, and in
   Settings > Pages choose "Deploy from a branch" with that branch and `/ (root)`. Open
   `https://<user>.github.io/<repository>/`.
4. **A third host** (for example Netlify Drop, Cloudflare Pages or Neocities): upload the unzipped
   folder and open the address it gives.
5. On each host, play level 1 through to its exit, open level 2, and check the browser console
   for errors. Take a screenshot of level 2 and save it under `docs/qa/host-compat/`.

## Results

| Date | Host | Zip SHA-256 | Result | Screenshot | Notes |
|---|---|---|---|---|---|
| | itch.io | | Not yet checked | | |
| | GitHub Pages | | Not yet checked | | |
| | (third host) | | Not yet checked | | |
