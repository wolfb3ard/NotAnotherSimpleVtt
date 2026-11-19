# Saved sheet compatibility

The database still stores sheet format `version: 1`. `compatibilityVersion` is an additive app-level revision inside that format. An absent compatibility revision means the document predates the upgrader.

Room reads preview safe upgrades for D&D characters and saved templates. The next full character save passes the upgraded document through the usual validation, permission checks, and revision guard. Resource-only writes keep using their existing counter updates. Opening a board doesn't write anything, and older templates aren't rewritten in place.

The first revision fills missing character-detail and builder settings and updates the exact old built-in initiative expression. It leaves custom rolls, progression decisions, inventory, spent resources, and token links alone. It doesn't attach a builder to a manual character or convert equipment bundles. Bundle conversion remains an explicit action with an inventory preview in the builder.

If an upgrade fails validation, the sheet window keeps the original available for download and shows the validation issue instead of saving a partial upgrade.

For further upgrades, add a deterministic step for the prior compatibility revision and cover it with a historical fixture. Keep storage format changes separate and coordinate those with the database validator. Don't run the builder or infer new player choices in an automatic upgrade.
