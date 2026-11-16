{{TITLE}}

This folder is a complete web game made with Retro FPS GCS. It runs in any
modern browser, from any static web host, with no server code, no build step
and no account.


CONTENTS

  index.html               The page that starts the game
  game.<hash>.js           The game runtime
  data/                    The levels, game settings and list of assets
  assets/                  Textures and models
  draco/                   Decoder for compressed models (only when a model needs it)
  CREDITS.txt              Who made each asset, and under which license
  THIRD_PARTY_NOTICES.txt  Licenses of the software the runtime includes
  LICENSE-runtime.txt      License of the game runtime
  README.txt               This file

Keep the files together and keep their names: the page finds everything by
relative paths, so the game works at a site's root or in any subfolder.
When you publish the game, keep CREDITS.txt, THIRD_PARTY_NOTICES.txt and
LICENSE-runtime.txt with it. Some asset licenses require the credit.


TEST IT ON YOUR COMPUTER

Opening index.html straight from disk does not work, because browsers do not
let a page load files from disk. Start any static file server in this folder
and open the address it prints. For example:

  With Python:   python -m http.server 8000
                 then open http://localhost:8000/
  With Node.js:  npx serve .


PUBLISH ON ITCH.IO

  1. Create a new project and set "Kind of project" to HTML.
  2. Upload the zip file exactly as the editor saved it, and tick "This file
     will be played in the browser".
  3. Choose a viewport size (for example 1280 x 720), turn on the fullscreen
     button, and save.


PUBLISH ON GITHUB PAGES

  1. Create a repository and add the files from this folder (not the zip) at
     its root, or in a docs/ folder.
  2. In the repository's Settings > Pages, choose "Deploy from a branch",
     pick the branch and folder, and save.
  3. After a minute or two the game is at
     https://<your-user-name>.github.io/<repository>/


PUBLISH ON OTHER STATIC HOSTS

Netlify, Cloudflare Pages, Neocities and any ordinary web server work the same
way: upload the files from this folder, keeping the folder structure. If a
compressed model does not load, check that the server sends .wasm files with
the type application/wasm; most servers do.
