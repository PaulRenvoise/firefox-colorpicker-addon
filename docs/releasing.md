# Releasing Pipette

Publishing a GitHub Release runs the release workflow. It checks that the tag and
versions agree, runs the unit tests and extension validator, builds Pipette, and
requests Mozilla's signature for self-distribution. Once signed, the workflow
attaches `pipette-VERSION.xpi` and its matching source archive to the release.

## One-time setup

1. Sign in to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/)
   with the account that will own Pipette. Complete the developer registration
   and accept Mozilla's distribution agreement.
2. Create [Mozilla API credentials](https://addons.mozilla.org/developers/addon/api/key/).
3. In this GitHub repository, open **Settings → Secrets and variables → Actions**
   and add these repository secrets:

   | Secret | Mozilla credential |
   | --- | --- |
   | `WEB_EXT_API_KEY` | JWT issuer |
   | `WEB_EXT_API_SECRET` | JWT secret |

The workflow uses Mozilla's **unlisted** channel, so Pipette is distributed through
GitHub without a public Mozilla listing. The built-in GitHub token uploads release
assets; no personal GitHub token is needed.

## Publish a version

1. Set the same version in `package.json` and `extension/manifest.json`, then commit
   and push. The first version is already `1.0.0`.
2. On GitHub, create a release with the matching tag, such as `v1.0.0`, targeting
   that commit. Publish the release. Saving a draft does not run the workflow.
3. Follow **Actions → Build and sign release**. When it succeeds, the release has
   a signed `.xpi` ready to install on Firefox desktop or Android.

Mozilla can select submissions for manual review. The workflow waits up to
30 minutes for signing; if it times out, use the Developer Hub to check the
submission and download the signed file once approved. Attach that file to the
existing GitHub Release as `pipette-VERSION.xpi`. Do not resubmit the same version
while it is pending review.

If signing succeeds but the GitHub upload fails, download the signed file from
the Developer Hub and attach it manually rather than submitting that version again.
Automatic updates are not configured yet; users can update by installing a newer
signed `.xpi`.

The workflow installs Node.js 24.19.0 and pnpm 11.25.0. To reproduce the submitted
build from the source archive, extract it and run:

```sh
pnpm install --frozen-lockfile
pnpm build
```

The extension files are in `dist/`. The release's **Source code** downloads contain
the development project; users should install the signed `.xpi` asset instead.

See [Mozilla's signing guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
and [installation instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/).
