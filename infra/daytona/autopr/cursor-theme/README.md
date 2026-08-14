# AutoPR CUA cursor theme

`build_theme.py` deterministically produces the `dev.autopr.cursor.neon`
dotLottie source consumed during the Daytona snapshot build. The script is
derived from CUA Driver 0.19.3's MIT-licensed `cua.default` generator and keeps
the same twelve semantic action animations and 128x128 vector contract.

AutoPR changes only the authored presentation: an electric-violet pointer,
lavender glow, cyan action marks, and a white contrast outline. CUA's pinned,
checksummed `cua-cursor-theme` sidecar validates and compiles the source during
the image build. The resulting `.cua-theme` is installed in the Daytona user's
standard CUA theme store; source archives and compiler binaries do not remain
in the runtime image.

To preview a change locally, use the compiler from CUA Driver 0.19.3:

```bash
python3 build_theme.py --output autopr-neon.lottie
cua-cursor-theme validate autopr-neon.lottie
cua-cursor-theme build autopr-neon.lottie \
  --output dev.autopr.cursor.neon.cua-theme
cua-cursor-theme preview dev.autopr.cursor.neon.cua-theme \
  --output preview
```
