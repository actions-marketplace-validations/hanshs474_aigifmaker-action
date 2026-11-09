# AI GIF Maker (GitHub Action)

Turn text into animated GIFs with AI GIF Maker. Native GIF generation — no video conversion. Type what you want and download your GIF in about a minute.

This official action runs [AI GIF Maker](https://aigifmaker.ai/?utm_source=github-action&utm_medium=package) inside a workflow: give it a prompt and it hands back the URL of a finished, looping GIF. Use it for release-note GIFs, a celebration GIF on every merged PR, a README banner refreshed on a schedule, or a reaction GIF your bot posts.

```yaml
- uses: hanshs474/aigifmaker-action@v1
  id: gif
  with:
    api-key: ${{ secrets.AIGIFMAKER_API_KEY }}
    prompt: "a rocket launching from a laptop keyboard, confetti, celebratory"
- run: echo "${{ steps.gif.outputs.gif-url }}"
```

Save it into the repository too:

```yaml
- uses: hanshs474/aigifmaker-action@v1
  with:
    api-key: ${{ secrets.AIGIFMAKER_API_KEY }}
    prompt: "a corgi in sunglasses dancing on a beach"
    output-path: assets/release.gif
```

## Inputs

| Input | |
|---|---|
| `prompt` | required. What the GIF should show |
| `api-key` | required. Create a key at https://aigifmaker.ai/settings/apikeys and store it as a repository secret `AIGIFMAKER_API_KEY` |
| `output-path` | optional. Download the GIF to this path in the workspace |
| `timeout-minutes` | optional, default 5 |

## Outputs

| Output | |
|---|---|
| `gif-url` | URL of the finished GIF |
| `path` | where the GIF was saved, if `output-path` was set |
| `id` | the AI GIF Maker task id |

## Credits

Each GIF costs 1 credit on your AI GIF Maker account, the same as on the website. New accounts get one free GIF (it carries a small aigifmaker.ai badge). If a GIF fails, its credit is refunded. Credit packs are on the [pricing](https://aigifmaker.ai/pricing?utm_source=github-action&utm_medium=package) page.

Accounts that have not bought credits yet may wait in a short queue before the GIF starts; the action keeps polling until the timeout. The step fails with the service's own message on a missing or wrong key, an empty balance, or a refused prompt.

No dependencies (`node test.js` runs the offline tests, `node test.js --live` adds two free live checks). Questions: support@aigifmaker.ai. MIT licensed.
