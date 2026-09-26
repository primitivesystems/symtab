# Symtab plugin runtime

`VaultPluginHost` owns one browser Worker per open vault. Every plugin gets a separate SES
compartment inside that Worker. The compartment has no Node, Electron, filesystem, shell,
timer, or network globals; its only authority is the capability client passed during
activation.

Plugin entries must be self-contained browser IIFEs built from `definePlugin`. The standard
template's `bun run build` produces this format. Imports must be bundled before installation.

The host's `capabilityHandler` must still enforce the persisted server-side grant for every
call. Use `onDisabled` to persist automatic disablement after repeated failures, and call
`dispose()` when the vault context is evicted.

