# Installed fonts for Reader

Reader will use the Mac's installed font families for body and heading choices.
AppKit owns that list. The existing native bridge returns family names to Reader's
main frame after its origin check. The comparison pane asks its trusted parent.
No HTTP endpoint, font file read, network request, or new permission is introduced.

Keep Lora as the sole bundled default. Remove the other bundled font families.
Use the operating system interface and monospace stacks. Code keeps its system
monospace default and can choose from the same installed families in the Mac app.
The options come from the API, not a curated family inventory.

Refresh the family list at boot and when Settings opens. Keep existing preference
keys. New installed choices use `font:` followed by the exact family name. A small
legacy-key map recognizes previous choices when that family is installed. Missing
families stay saved, show an unavailable label, and render with the default until
installed again. Selector labels use textContent; CSS family names are quoted and
escaped. Failed enumeration keeps the last successful list and explains the error.

Browser and embedded settings offer Lora and generic system stacks only. Their
saved unavailable choices show fallback instead of being silently overwritten.
Do not call queryLocalFonts or request browser permissions. The embedded host SDK
has no font enumeration capability. Preserve adaptive Settings and runner changes.

The owner explicitly requested installed OS font selection through a native API.
This adds one action to the existing internal bridge and preserves saved keys.
No document access or write policy changes.
