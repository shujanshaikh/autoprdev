# Daytona hardware cursor mask

`build_hidden_xcursor.py` creates the internal `AutoPRHidden` Xcursor theme.
It does not render branding or replace CUA's pointer. It makes the real X11
pointer bitmap transparent while preserving pointer movement and input
delivery.

CUA Driver 0.20 renders its built-in `cua.default` animated overlay from an
unlabeled, transport-owned implicit session. Daytona's recorder can also fetch
the hardware cursor through XFixes and composite it over desktop pixels, so the
launcher activates `AutoPRHidden` only after that label-safe overlay is ready.
It restores Adwaita whenever computer-server uses the native fallback.
