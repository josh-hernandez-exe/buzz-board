# Choosing a licence

There's no licence file yet. Without one, the code is "all rights reserved" by default: people can read it on GitHub, but have no right to copy, change or host it. That's a safe place to be while you decide. This note sets out the choices; it isn't legal advice.

## Code

| Licence                                       | Others may                                                    | They must                                                                                  | Good if you want                                                        |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **MIT**                                       | Use, change, host and sell it, in open or closed projects     | Keep the copyright and licence notice                                                      | The most people to use and contribute, with the least friction          |
| **Apache-2.0**                                | Same as MIT                                                   | Same, plus state significant changes; includes an explicit patent grant                     | MIT's freedom with clearer legal terms, common in larger projects       |
| **AGPL-3.0**                                  | Use, change and host it                                       | Publish their source, **including when they only host a modified version as a website**    | Nobody to run a closed, modified Buzz Board as a service                |
| **All rights reserved** (no licence, current) | Read it                                                       | Ask you for permission to do anything else                                                 | To keep every option open for now                                       |

Things to know:

- **You can move from "all rights reserved" to any of these later.** Moving from a permissive licence to a stricter one later only affects new versions; copies already released under MIT stay MIT.
- **Contributions:** once others contribute code under a licence, relicensing needs their agreement, unless you ask contributors to agree to a contributor licence agreement first. [CONTRIBUTING.md](../CONTRIBUTING.md) would say which.
- **Dependencies** are mostly MIT, Apache-2.0 or ISC, which all fit with any choice above. Run `bunx license-checker --summary` before publishing to confirm.
- **The sound effects** are listed under "External Sources" in the [README](../README.md). Check each one's licence before any public release; some sound sites forbid redistribution.

**Suggestion:** if you want people to use and improve it freely, pick **MIT**. If you mainly care that improvements to a hosted version come back to everyone, pick **AGPL-3.0**. If you're unsure, stay as you are until the first public release.

## Event content and assets

Your trivia questions, board answers, logos, images and sounds are separate from the code and can have their own terms:

- **Keep event content out of this repository.** The plan already requires it, and it stops answers leaking before the event.
- If you want to share a pack afterwards, **CC BY 4.0** (anyone may reuse with credit) or **CC BY-NC 4.0** (non-commercial reuse only) are the usual choices for content.
- Only use images, sounds and music you made, have permission for, or that are clearly licensed for reuse. TV show names, logos and theme music are trademarks or copyrighted: call your game something like "Holiday Family Feud night" in your own invitations if you like, but don't put the show's logo, theme or name in the app or its assets.

## To decide

1. A code licence (or stay as you are for now).
2. Whether contributors need to agree to anything.
3. The app's public name and logo, avoiding TV-show trademarks.
