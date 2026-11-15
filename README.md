# Retro FPS GCS

A browser-based game creation system for retro first-person shooters. Build grid-based levels in a 2D and 3D editor, wire up doors, keys, lifts and triggers without code, play-test in the same window, and export the result as a playable web game.

The editor runs at <https://neuraldrifter.github.io/Retro_FPS_GCS/>.

## Status

Pre-release (version 0.1.0). The work toward a public release is tracked in [docs/release-plan.md](docs/release-plan.md).

## Running it locally

Requires Node 24 (see `.nvmrc`).

```sh
npm ci              # install the exact dependency versions in package-lock.json
npm run dev         # start the editor at http://localhost:3000
npm test            # unit tests (Vitest)
npm run test:e2e    # build for GitHub Pages and run the Playwright smoke tests
```

Before the first `npm run test:e2e`, install the test browser with `npx playwright install chromium`.

`npm run dev` listens on localhost only. Use `npm run dev:lan` to open it to other devices on your network.

## License

The editor and the game runtime are released under the [MIT License](LICENSE). The asset
library's textures and models are CC0 (public domain); see
[Retro_FPS_GCS-assets](https://github.com/NeuralDrifter/Retro_FPS_GCS-assets).

## Built with AI models

This project was developed with the help of these AI models:

| | Provider | Models |
|:---:|---|---|
| <img src="https://cdn.simpleicons.org/anthropic/191919/F0EEE6" alt="Anthropic logo" width="24" height="24"> | [Anthropic](https://www.anthropic.com) | Claude Opus 5.5, Claude Fable 5, Claude Fable 5.2 |
| <img src="https://cdn.simpleicons.org/google/4285F4" alt="Google logo" width="24" height="24"> | [Google](https://ai.google.dev) | Gemini 4 Argon, Carbon, Gemini 3.8 Flash |
| <img src="https://cdn.simpleicons.org/deepseek/4D6BFE" alt="DeepSeek logo" width="24" height="24"> | [DeepSeek](https://www.deepseek.com) | DeepSeek |

Logos are trademarks of their owners and are served by [Simple Icons](https://simpleicons.org).
