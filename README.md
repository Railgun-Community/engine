Engine Monorepo
---
- Install turbo globally: `pnpm add turbo --global`
- Install deps for all workspaces: `pnpm i`
- Build all: `turbo run build` or `pnpm build`
- Lint all: `turbo run lint`
- Test all: `turbo run test`
- `turbo run lint test build`
- Execute task on one library with `--filter engine`: `pnpm add <package> --filter engine`


*Todo*
---
- CI
- split libs/engine into multiple libs
- common base config for eslint (possibly new flat format)
- common base config for tsconfig


