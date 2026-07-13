# Changelog

All notable changes to BoardReadyOps are recorded here.

## Unreleased

## [1.12.0](https://github.com/oaslananka/boardreadyops/compare/v1.11.0...v1.12.0) (2026-07-13)


### Features

* **runner:** add execution routing policy ([#171](https://github.com/oaslananka/boardreadyops/issues/171)) ([3bcea5f](https://github.com/oaslananka/boardreadyops/commit/3bcea5fab7ead4703180f389341d36a63c04cb16))

## [1.11.0](https://github.com/oaslananka/boardreadyops/compare/v1.10.0...v1.11.0) (2026-07-13)


### Features

* **runner:** add artifact capability and upload routes ([#160](https://github.com/oaslananka/boardreadyops/issues/160)) ([3ea6e42](https://github.com/oaslananka/boardreadyops/commit/3ea6e42e1dd9aac28cfd214db6a2a2dbd25d6b42))
* **runner:** add artifact upload capability store ([#159](https://github.com/oaslananka/boardreadyops/issues/159)) ([921c4b0](https://github.com/oaslananka/boardreadyops/commit/921c4b088279c87efb9c9b8c0a1d84679103b54e))
* **runner:** add self-hosted activation endpoint ([#164](https://github.com/oaslananka/boardreadyops/issues/164)) ([72c1e8c](https://github.com/oaslananka/boardreadyops/commit/72c1e8ca7f7a44af47ec8bbfa6b04c0e16ad7fc8))
* **runner:** add self-hosted enrollment store ([#163](https://github.com/oaslananka/boardreadyops/issues/163)) ([7cfaadf](https://github.com/oaslananka/boardreadyops/commit/7cfaadf1b9c82ec6cbcc490e97de2e24e2e2cc37))
* **runner:** add signed claim and lease routes ([#158](https://github.com/oaslananka/boardreadyops/issues/158)) ([3c99ecf](https://github.com/oaslananka/boardreadyops/commit/3c99ecf82365034c6a8d31f0d1bdde7013872714))
* **runner:** add signed lease protocol foundation ([#155](https://github.com/oaslananka/boardreadyops/issues/155)) ([5ecae92](https://github.com/oaslananka/boardreadyops/commit/5ecae92472d806dd1328a80d75c205aa01c2e2a9))
* **runner:** add signed terminal result route ([#162](https://github.com/oaslananka/boardreadyops/issues/162)) ([c26a459](https://github.com/oaslananka/boardreadyops/commit/c26a459230afeb262af64aaf81b440044d845640))
* **runner:** add transactional lease store ([#157](https://github.com/oaslananka/boardreadyops/issues/157)) ([e520dda](https://github.com/oaslananka/boardreadyops/commit/e520dda52807f97dc5a301d6624d34bcb4af1e24))
* **runner:** authorize signed terminal results ([#161](https://github.com/oaslananka/boardreadyops/issues/161)) ([94b0e5f](https://github.com/oaslananka/boardreadyops/commit/94b0e5fa2365db14c996331ca9da81567682f98f))

## [1.10.0](https://github.com/oaslananka/boardreadyops/compare/v1.9.0...v1.10.0) (2026-07-12)


### Features

* **core:** track release run attempts ([#146](https://github.com/oaslananka/boardreadyops/issues/146)) ([83d5d21](https://github.com/oaslananka/boardreadyops/commit/83d5d216f9706e77a9e8a78bc5195e59c52df6e6))


### Bug Fixes

* **core:** tolerate unavailable readiness comments ([#148](https://github.com/oaslananka/boardreadyops/issues/148)) ([f3cc4ec](https://github.com/oaslananka/boardreadyops/commit/f3cc4ec32eaa18618af0565199740852ab6c6d43))

## [1.9.0](https://github.com/oaslananka/boardreadyops/compare/v1.8.4...v1.9.0) (2026-07-12)


### Features

* **core:** persist versioned runner results ([#144](https://github.com/oaslananka/boardreadyops/issues/144)) ([8f8b6b9](https://github.com/oaslananka/boardreadyops/commit/8f8b6b94f377a510bf836e7d547bb73c61f9139b))

## [1.8.4](https://github.com/oaslananka/boardreadyops/compare/v1.8.3...v1.8.4) (2026-07-11)


### Bug Fixes

* **release:** use publisher token for GHCR ([#142](https://github.com/oaslananka/boardreadyops/issues/142)) ([7efd10c](https://github.com/oaslananka/boardreadyops/commit/7efd10c54482af5c5c7bab631704f04500c64bfa))

## [1.8.3](https://github.com/oaslananka/boardreadyops/compare/v1.8.2...v1.8.3) (2026-07-11)


### Bug Fixes

* **core:** bind runner results to execution attempts ([#140](https://github.com/oaslananka/boardreadyops/issues/140)) ([4074403](https://github.com/oaslananka/boardreadyops/commit/407440369edcab46fb1ec5160217bfd23bbd83f7))

## [1.8.2](https://github.com/oaslananka/boardreadyops/compare/v1.8.1...v1.8.2) (2026-07-11)


### Bug Fixes

* **core:** persist runner results atomically ([#137](https://github.com/oaslananka/boardreadyops/issues/137)) ([f3b83df](https://github.com/oaslananka/boardreadyops/commit/f3b83dfa0c6f7befd282e2c7622ff5b560d06791))
* **core:** reject superseded runner results ([#139](https://github.com/oaslananka/boardreadyops/issues/139)) ([7d67ea3](https://github.com/oaslananka/boardreadyops/commit/7d67ea378b01801e728a52593e8c058240fb9848))

## [1.8.1](https://github.com/oaslananka/boardreadyops/compare/v1.8.0...v1.8.1) (2026-07-11)


### Bug Fixes

* **ci:** accept npm 12 pack metadata ([#134](https://github.com/oaslananka/boardreadyops/issues/134)) ([552596d](https://github.com/oaslananka/boardreadyops/commit/552596d3b76fa21a63cd0bf1841498dc23881921))
* **ci:** parse npm 12 package maps ([#135](https://github.com/oaslananka/boardreadyops/issues/135)) ([ab72c61](https://github.com/oaslananka/boardreadyops/commit/ab72c61c8d2cf99f4b77ebc4919a58173a2d04c9))
* **ci:** verify npm tarballs directly ([#132](https://github.com/oaslananka/boardreadyops/issues/132)) ([741df47](https://github.com/oaslananka/boardreadyops/commit/741df47e9f6a5f6f1fa2c0e954f61c3300055cfc))

## [1.8.0](https://github.com/oaslananka/boardreadyops/compare/v1.7.2...v1.8.0) (2026-07-11)


### Features

* **adapters:** add Zephyr, ESP-IDF, and STM32CubeMX firmware contract adapters ([#74](https://github.com/oaslananka/boardreadyops/issues/74)) ([1580cdc](https://github.com/oaslananka/boardreadyops/commit/1580cdc7556e606707db778582d19c915bbfc673)), closes [#40](https://github.com/oaslananka/boardreadyops/issues/40)
* add cloud database bootstrap migrations ([#68](https://github.com/oaslananka/boardreadyops/issues/68)) ([6596105](https://github.com/oaslananka/boardreadyops/commit/6596105fa758b66ce209aee6640bb0deaec7dffc))
* add GitHub App lifecycle persistence ports ([#65](https://github.com/oaslananka/boardreadyops/issues/65)) ([46c0228](https://github.com/oaslananka/boardreadyops/commit/46c022830c6e0103e37ff3d5b6f7f7b453ab95e4))
* add readiness runner workflow ([f0c5daf](https://github.com/oaslananka/boardreadyops/commit/f0c5daf0897f2a3db5eb2d1b76b9292de9834252))
* add readiness workflow lifecycle dispatch hooks ([70a1d8c](https://github.com/oaslananka/boardreadyops/commit/70a1d8c727bdfa53abcf3c4e9ae64a7cfa5007e6))
* add self-hosted cloud skeleton ([#61](https://github.com/oaslananka/boardreadyops/issues/61)) ([56a571d](https://github.com/oaslananka/boardreadyops/commit/56a571dab414cf1abbc327da0d2c69551d0cb5a0))
* **bom:** add approved alternates schema and suppress single-source risk for documented substitutes ([#75](https://github.com/oaslananka/boardreadyops/issues/75)) ([8ea5063](https://github.com/oaslananka/boardreadyops/commit/8ea5063b3dbc9b1a9860ec3272d96dd69deb3cbd)), closes [#36](https://github.com/oaslananka/boardreadyops/issues/36)
* **bom:** add bom.risk-score rule and BOM supply-chain risk summary ([#76](https://github.com/oaslananka/boardreadyops/issues/76)) ([7451205](https://github.com/oaslananka/boardreadyops/commit/7451205e88ec30918788e7ba4d438756e8c249b9)), closes [#37](https://github.com/oaslananka/boardreadyops/issues/37)
* **bom:** add component identity normalization and conflict detection ([#78](https://github.com/oaslananka/boardreadyops/issues/78)) ([2af8e5a](https://github.com/oaslananka/boardreadyops/commit/2af8e5a43047de845f34efec0490bdbe3531c02b))
* **bom:** lifecycle status abstraction and unknown-lifecycle rule (closes [#38](https://github.com/oaslananka/boardreadyops/issues/38)) ([10e58cb](https://github.com/oaslananka/boardreadyops/commit/10e58cb74762a82b9d518769148600949dc52134))
* **bom:** supplier intelligence plugin interface and static provider (closes [#39](https://github.com/oaslananka/boardreadyops/issues/39)) ([7451dec](https://github.com/oaslananka/boardreadyops/commit/7451dec4dc665954cadb47994536d5d4dc0baa65))
* **core:** render hosted release run details ([#113](https://github.com/oaslananka/boardreadyops/issues/113)) ([f5ca4a3](https://github.com/oaslananka/boardreadyops/commit/f5ca4a345e9da575dac3b53c642000df5fdce999))
* **core:** rule pack architecture with defineRulePack and 5 built-in presets (closes [#50](https://github.com/oaslananka/boardreadyops/issues/50), closes [#51](https://github.com/oaslananka/boardreadyops/issues/51)) ([5080332](https://github.com/oaslananka/boardreadyops/commit/508033220de195e1acff0591bcb990b2b1bd73ec))
* **core:** serve signed artifact downloads ([#115](https://github.com/oaslananka/boardreadyops/issues/115)) ([5bbf126](https://github.com/oaslananka/boardreadyops/commit/5bbf126b6d686c1597acac3fa5d5242599d4e419))
* create PR readiness check run lifecycle ([94944ed](https://github.com/oaslananka/boardreadyops/commit/94944ed77b367e6974cd589bd39d2366a9d264ab))
* **db:** add self-hosted runner registration foundation ([#118](https://github.com/oaslananka/boardreadyops/issues/118)) ([55c64c8](https://github.com/oaslananka/boardreadyops/commit/55c64c8a1263a8cbda2cc75eead6d641228d57ff))
* **db:** add tenant-scoped audit log foundation ([#119](https://github.com/oaslananka/boardreadyops/issues/119)) ([5b5abec](https://github.com/oaslananka/boardreadyops/commit/5b5abec5938e7e3b65b8548ad8a94657ffc6a5b4))
* **docs:** shareable public demo scenarios with pre-generated reports (closes [#49](https://github.com/oaslananka/boardreadyops/issues/49)) ([29db629](https://github.com/oaslananka/boardreadyops/commit/29db62946a3cd99613cb125664e7dc677443e5c1))
* **github-app:** add private repo and fork PR safe mode ([#117](https://github.com/oaslananka/boardreadyops/issues/117)) ([e967381](https://github.com/oaslananka/boardreadyops/commit/e967381198bcfaa2c4df8d6d669adf3772228a17))
* normalize GitHub App lifecycle events ([#64](https://github.com/oaslananka/boardreadyops/issues/64)) ([5c60432](https://github.com/oaslananka/boardreadyops/commit/5c6043252b46a951a5fe726e0eabd41128e17c40))
* persist GitHub webhook lifecycle actions ([#66](https://github.com/oaslananka/boardreadyops/issues/66)) ([ab060c1](https://github.com/oaslananka/boardreadyops/commit/ab060c1a6c5830fa6f196088fc5a2cc2bd001c17))
* persist GitHub webhook lifecycle actions ([#67](https://github.com/oaslananka/boardreadyops/issues/67)) ([2b88cc5](https://github.com/oaslananka/boardreadyops/commit/2b88cc5a91fa20fa8c6e66d7f57002ed72ad9aa7))
* **release:** add prototype/pilot/production release modes ([#77](https://github.com/oaslananka/boardreadyops/issues/77)) ([0e15675](https://github.com/oaslananka/boardreadyops/commit/0e1567514c6da2410db7183152ba84a780d002d0)), closes [#31](https://github.com/oaslananka/boardreadyops/issues/31)
* **release:** add release manifest schema, checksums.txt, and manifest coverage verification ([#81](https://github.com/oaslananka/boardreadyops/issues/81)) ([eb647b6](https://github.com/oaslananka/boardreadyops/commit/eb647b67b634ad8a6f5f2c60f2a7369d5e08a4d5))
* **release:** run diff comparison and release history trend analysis (closes [#27](https://github.com/oaslananka/boardreadyops/issues/27), closes [#29](https://github.com/oaslananka/boardreadyops/issues/29)) ([5da9e97](https://github.com/oaslananka/boardreadyops/commit/5da9e97a7cbc989afa3b00ea3a0814732bb01648))
* **report:** standardize report contracts with evidence schema, SARIF tags, and JUnit timestamp ([#79](https://github.com/oaslananka/boardreadyops/issues/79)) ([4717933](https://github.com/oaslananka/boardreadyops/commit/4717933d8e608719a460ce032a4bd7582339913d))
* **rules:** add manufacturing.package-completeness rule ([#80](https://github.com/oaslananka/boardreadyops/issues/80)) ([1b6d13a](https://github.com/oaslananka/boardreadyops/commit/1b6d13a030d6734a65e5290349cfdb00626c716b)), closes [#30](https://github.com/oaslananka/boardreadyops/issues/30)
* **runner:** add fail-closed runner mode configuration ([#120](https://github.com/oaslananka/boardreadyops/issues/120)) ([2bfd090](https://github.com/oaslananka/boardreadyops/commit/2bfd0904c756cc4b0c729e9e5d27a6510e65d088))
* **runner:** sign callbacks and publish product readiness output ([#116](https://github.com/oaslananka/boardreadyops/issues/116)) ([f812274](https://github.com/oaslananka/boardreadyops/commit/f81227478821739c2d97a658a800a630eec8445c))
* **vendors:** add generic preset profiles for prototype, assembly-ready, and production ([#82](https://github.com/oaslananka/boardreadyops/issues/82)) ([8b0c06c](https://github.com/oaslananka/boardreadyops/commit/8b0c06cec7344a76a426def840fc1f7252456dea)), closes [#32](https://github.com/oaslananka/boardreadyops/issues/32)
* wire web runner client into GitHub webhook lifecycle ([1589257](https://github.com/oaslananka/boardreadyops/commit/1589257d23d2e0217e2e636baee03a368e256994)), closes [#21](https://github.com/oaslananka/boardreadyops/issues/21)


### Bug Fixes

* add runtime JS check run client ([cb6dae6](https://github.com/oaslananka/boardreadyops/commit/cb6dae61ec1d74536203ca3c2ec924e160a30420))
* **ci:** make release preflight reproducible ([#131](https://github.com/oaslananka/boardreadyops/issues/131)) ([8e86187](https://github.com/oaslananka/boardreadyops/commit/8e86187842a6d5222965b14fabc6a1c7f33dabdd))
* **ci:** use release token for release pull requests ([#129](https://github.com/oaslananka/boardreadyops/issues/129)) ([160aa63](https://github.com/oaslananka/boardreadyops/commit/160aa63e1a85026d9fb5c83cd88ddfdaa657849e))
* copy scripts into web Docker deps stage ([#70](https://github.com/oaslananka/boardreadyops/issues/70)) ([cc86032](https://github.com/oaslananka/boardreadyops/commit/cc86032a0776eb1452fcf081f3b80649a57cabf0))
* **core:** authenticate runner callbacks with GitHub OIDC ([#128](https://github.com/oaslananka/boardreadyops/issues/128)) ([7a3b6cf](https://github.com/oaslananka/boardreadyops/commit/7a3b6cfd821c7bae7eb16ee25c8209b7e22a05a0))
* **core:** support file-backed runtime secrets ([#126](https://github.com/oaslananka/boardreadyops/issues/126)) ([9a6d679](https://github.com/oaslananka/boardreadyops/commit/9a6d679ddf7190968575923e13a018cc63b68b6c))
* **core:** tolerate unavailable readiness comments ([#127](https://github.com/oaslananka/boardreadyops/issues/127)) ([ed83e7b](https://github.com/oaslananka/boardreadyops/commit/ed83e7b9a146609abca0be6725cf39271bad26e1))
* **github-app:** make release rollout opt-in by config ([#109](https://github.com/oaslananka/boardreadyops/issues/109)) ([eeb9f6e](https://github.com/oaslananka/boardreadyops/commit/eeb9f6ed5819c96a6cee4ca6f618e00ae0391e4d))
* make cloud releases immutable ([#124](https://github.com/oaslananka/boardreadyops/issues/124)) ([875baf8](https://github.com/oaslananka/boardreadyops/commit/875baf82ae450c997523079454959d5820bc29b5))
* make webhook lifecycle store resolvable by Next ([#69](https://github.com/oaslananka/boardreadyops/issues/69)) ([44a219c](https://github.com/oaslananka/boardreadyops/commit/44a219c4335a771f9f4167db579485c1568d5137))
* quiet idempotent deploy cleanup ([#125](https://github.com/oaslananka/boardreadyops/issues/125)) ([7bf4078](https://github.com/oaslananka/boardreadyops/commit/7bf407809a3f73d427aa663bb3ca3bb4216467e3))
* relink repository installation on upsert ([7ec3820](https://github.com/oaslananka/boardreadyops/commit/7ec382006344bd0867d00678a4db8992fb72f2f0))
* restrict BoardReadyOps checks to enabled repositories ([ccec5d4](https://github.com/oaslananka/boardreadyops/commit/ccec5d4f7f0a90c7f927a59a9f9aa5f044c5b104))
* return pg query results ([79bf78b](https://github.com/oaslananka/boardreadyops/commit/79bf78b7a111257e0fbc971be877bbf0a42a681c))
* upsert PR webhook state before enqueue ([#98](https://github.com/oaslananka/boardreadyops/issues/98)) ([6a00f94](https://github.com/oaslananka/boardreadyops/commit/6a00f94d4697c98119b013dad37ad2152e502501))

## [1.7.2](https://github.com/oaslananka/boardreadyops/compare/v1.7.1...v1.7.2) (2026-06-28)


### Bug Fixes

* **ci:** rebuild dist in release-please regeneration step ([a8283df](https://github.com/oaslananka/boardreadyops/commit/a8283dfcbb49193cd3088ce818ee733df290a59a))
* **release:** prevent version leaks from breaking the release pipeline ([1def6ea](https://github.com/oaslananka/boardreadyops/commit/1def6ea834b69bdfb069c53434dd5a70396f4879))

## [1.7.1](https://github.com/oaslananka/boardreadyops/compare/v1.7.0...v1.7.1) (2026-06-27)


### Bug Fixes

* resolve GC duplicate code, coverage thresholds, stale dist bundle ([680f751](https://github.com/oaslananka/boardreadyops/commit/680f7514e2a06b867547e43a8e39a34f0e638104))

## [1.7.0](https://github.com/oaslananka/boardreadyops/compare/v1.6.2...v1.7.0) (2026-06-24)


### Features

* expand vendor fabrication profiles ([12ae7b5](https://github.com/oaslananka/boardreadyops/commit/12ae7b5fd560af923c20a6ba0a8dbd777ce1c801)), closes [#236](https://github.com/oaslananka/boardreadyops/issues/236)
* harden release channels and add agent planning output ([#241](https://github.com/oaslananka/boardreadyops/issues/241)) ([bc6ad51](https://github.com/oaslananka/boardreadyops/commit/bc6ad510ded21e1844aee3fa94b840e978bed637))
* harden report finding identity ([#248](https://github.com/oaslananka/boardreadyops/issues/248)) ([bc4a02f](https://github.com/oaslananka/boardreadyops/commit/bc4a02fb42ab63f116330d82e7c0478c8f5c4284))
* harden waiver governance ([974fa56](https://github.com/oaslananka/boardreadyops/commit/974fa56bd69c369ab7c8cb7173a3166ce1781b72))
* run KiCad jobsets during release prepare ([#246](https://github.com/oaslananka/boardreadyops/issues/246)) ([d82d847](https://github.com/oaslananka/boardreadyops/commit/d82d84751f527e6d16f597a122575ce00b52d78c))

## [1.6.2](https://github.com/oaslananka/boardreadyops/compare/v1.6.1...v1.6.2) (2026-06-23)


### Documentation

* regenerate release history for the 1.6.x releases ([#230](https://github.com/oaslananka/boardreadyops/issues/230)) ([5d06ca0](https://github.com/oaslananka/boardreadyops/commit/5d06ca0462f2ef3578a572441336bca805bb8956))

## [1.6.0](https://github.com/oaslananka/boardreadyops/compare/v1.5.2...v1.6.0) (2026-06-23)


### Features

* **action:** add app-style release review pull request comment ([#228](https://github.com/oaslananka/boardreadyops/issues/228)) ([f9f6960](https://github.com/oaslananka/boardreadyops/commit/f9f6960533b57643eb3d3a184277efa1dfa82815))
* **adapters:** add firmware contract adapter ecosystem with Arduino adapter ([#225](https://github.com/oaslananka/boardreadyops/issues/225)) ([2aae098](https://github.com/oaslananka/boardreadyops/commit/2aae0986d0e48c17a572254cc13208662078be32))
* **bom:** add RoHS/REACH compliance intelligence ([#224](https://github.com/oaslananka/boardreadyops/issues/224)) ([7d1a1db](https://github.com/oaslananka/boardreadyops/commit/7d1a1db2cac65a97bc913857673e859cdc0175c4))
* **cli:** add generate command for first-party KiCad outputs ([#211](https://github.com/oaslananka/boardreadyops/issues/211)) ([1e81a46](https://github.com/oaslananka/boardreadyops/commit/1e81a467b5c7aacb80b1676b6e577a6ad1f1cc8e))
* **core:** add configurable release policy engine ([#219](https://github.com/oaslananka/boardreadyops/issues/219)) ([a73a832](https://github.com/oaslananka/boardreadyops/commit/a73a832fc30181c0e231643b20646cd34f24d3c4))
* **core:** add waivers and approval workflow ([#220](https://github.com/oaslananka/boardreadyops/issues/220)) ([61507fa](https://github.com/oaslananka/boardreadyops/commit/61507fa84ecfa4e66111396d33f9c3031143a696))
* **release:** add manufacturer handoff package command ([#215](https://github.com/oaslananka/boardreadyops/issues/215)) ([42fb449](https://github.com/oaslananka/boardreadyops/commit/42fb4494af1cbb14bee564788723e6a13cbee7eb)), closes [#196](https://github.com/oaslananka/boardreadyops/issues/196)
* **release:** add release prepare workflow command ([#212](https://github.com/oaslananka/boardreadyops/issues/212)) ([b52c947](https://github.com/oaslananka/boardreadyops/commit/b52c9473fbb61d37cab34ad1277abe481cdd4925))
* **release:** add release-to-release diff engine ([#218](https://github.com/oaslananka/boardreadyops/issues/218)) ([1ad6cdd](https://github.com/oaslananka/boardreadyops/commit/1ad6cdd0ad3a6be65a6fb9db89c722200a3a587a)), closes [#199](https://github.com/oaslananka/boardreadyops/issues/199)
* **release:** add signed manifest provenance and verification ([#222](https://github.com/oaslananka/boardreadyops/issues/222)) ([a9e0945](https://github.com/oaslananka/boardreadyops/commit/a9e09454b401e54a108909dc54ef7c6b4c7d1707))
* **release:** upgrade evidence bundle to structured v2 release record ([#214](https://github.com/oaslananka/boardreadyops/issues/214)) ([99495b9](https://github.com/oaslananka/boardreadyops/commit/99495b94b152f3e6a5407617299ca90aba58459b)), closes [#195](https://github.com/oaslananka/boardreadyops/issues/195)
* **report:** add explainable vendor readiness score ([#216](https://github.com/oaslananka/boardreadyops/issues/216)) ([f7f4314](https://github.com/oaslananka/boardreadyops/commit/f7f431467725fff793fceff1690e3c38db833992))
* **report:** turn the HTML report into a release dashboard ([#217](https://github.com/oaslananka/boardreadyops/issues/217)) ([d3263d0](https://github.com/oaslananka/boardreadyops/commit/d3263d03a72f0c627bd61d86038fcc13993ac114)), closes [#198](https://github.com/oaslananka/boardreadyops/issues/198)
* **rules:** expand DFM/DFA rule corpus ([#223](https://github.com/oaslananka/boardreadyops/issues/223)) ([f343017](https://github.com/oaslananka/boardreadyops/commit/f3430176332260c744ac1dcdfa9cf4b1dfbc6058))


### Bug Fixes

* **ci:** align coverage trigger with measured paths and harden a11y check ([#221](https://github.com/oaslananka/boardreadyops/issues/221)) ([b9db68c](https://github.com/oaslananka/boardreadyops/commit/b9db68cc7119f25b7ef4aceb1d4a62f88e21d459))


### Documentation

* add golden demo and fixture corpus ([#227](https://github.com/oaslananka/boardreadyops/issues/227)) ([24e551d](https://github.com/oaslananka/boardreadyops/commit/24e551d4eed84281e87790b5115f8067388df446))

## [1.5.2](https://github.com/oaslananka/boardreadyops/compare/v1.5.1...v1.5.2) (2026-06-21)


### Documentation

* add DeepWiki badge ([f790a0a](https://github.com/oaslananka/boardreadyops/commit/f790a0a30da5aa0cc3e4f78336549caedcb4673b))

## [1.5.1](https://github.com/oaslananka/boardreadyops/compare/v1.5.0...v1.5.1) (2026-06-21)


### Bug Fixes

* **docs:** restore header source contrast ([830eb2d](https://github.com/oaslananka/boardreadyops/commit/830eb2dbb82aee9082987dd7b8eef10c2e3799de))
* **docs:** restore header source contrast ([cb47479](https://github.com/oaslananka/boardreadyops/commit/cb474793c2c837bbcb0ec28e21987f3c7abccf2d))

## [1.5.0](https://github.com/oaslananka/boardreadyops/compare/v1.4.6...v1.5.0) (2026-06-21)


### Features

* add first DFM and DFA rules ([#175](https://github.com/oaslananka/boardreadyops/issues/175)) ([18e4095](https://github.com/oaslananka/boardreadyops/commit/18e4095031cb6eb1c1bbaefc82fc26f765ff2e91))
* add hierarchical schematic graph ([#172](https://github.com/oaslananka/boardreadyops/issues/172)) ([f0de008](https://github.com/oaslananka/boardreadyops/commit/f0de008fa81b7f2abec36688eafc278b70a435c1)), closes [#157](https://github.com/oaslananka/boardreadyops/issues/157)
* add release evidence bundles ([131d6b6](https://github.com/oaslananka/boardreadyops/commit/131d6b6940560af0443c53c22e734c48fc914dff))
* add release evidence bundles ([f2210e8](https://github.com/oaslananka/boardreadyops/commit/f2210e875c5f7be51f28063bc17f74090ef33322))
* add typed KiCad project model ([#170](https://github.com/oaslananka/boardreadyops/issues/170)) ([c3fc247](https://github.com/oaslananka/boardreadyops/commit/c3fc247f39d7bb6b28bf4d8a9df74277d18ed79a)), closes [#156](https://github.com/oaslananka/boardreadyops/issues/156)
* add vendor profiles ([3bd1034](https://github.com/oaslananka/boardreadyops/commit/3bd1034db7862266b0b76fa66fa90953c42fb98c))
* add vendor profiles ([4615be6](https://github.com/oaslananka/boardreadyops/commit/4615be6c9a3cc16d8535f0e1cc3478c5779b720f))
* **core:** add plugin permission model ([#185](https://github.com/oaslananka/boardreadyops/issues/185)) ([b2ea35d](https://github.com/oaslananka/boardreadyops/commit/b2ea35d13c8f74276589ff4e99a973a72d960c26))
* **rules:** add firmware pin contract check ([#186](https://github.com/oaslananka/boardreadyops/issues/186)) ([6be16a3](https://github.com/oaslananka/boardreadyops/commit/6be16a306a86e4b7ce044e4e7cf9803c7a85c76a))


### Bug Fixes

* harden release, Node, and KiCad compatibility ([#168](https://github.com/oaslananka/boardreadyops/issues/168)) ([f94cb02](https://github.com/oaslananka/boardreadyops/commit/f94cb021b993995bff2ad10fef522422bbcdc098)), closes [#153](https://github.com/oaslananka/boardreadyops/issues/153) [#154](https://github.com/oaslananka/boardreadyops/issues/154) [#155](https://github.com/oaslananka/boardreadyops/issues/155) [#161](https://github.com/oaslananka/boardreadyops/issues/161)


### Performance

* reduce bundles and enforce headroom budgets ([#176](https://github.com/oaslananka/boardreadyops/issues/176)) ([db415e6](https://github.com/oaslananka/boardreadyops/commit/db415e696b512447c1558c71b63221be26931085))


### Documentation

* clarify release readiness positioning ([#182](https://github.com/oaslananka/boardreadyops/issues/182)) ([b59bfbb](https://github.com/oaslananka/boardreadyops/commit/b59bfbb83f6954552a82a76373783266f8f004de))
* improve dark navigation accessibility ([#187](https://github.com/oaslananka/boardreadyops/issues/187)) ([31d0c9f](https://github.com/oaslananka/boardreadyops/commit/31d0c9f6306d0cbb05aab32a2af311a2f4fc0f06))


### Tests

* expand mutation gates for parsers and manufacturing rules ([#181](https://github.com/oaslananka/boardreadyops/issues/181)) ([71be7f6](https://github.com/oaslananka/boardreadyops/commit/71be7f635c1a298256f5b95fad1379b7f77be6bc))


### CI

* avoid blocking on stale review threads ([#184](https://github.com/oaslananka/boardreadyops/issues/184)) ([15f0522](https://github.com/oaslananka/boardreadyops/commit/15f0522fccc3fd093d7a3a503e1cbb7bd35cfe40))
* route checks by change risk ([#183](https://github.com/oaslananka/boardreadyops/issues/183)) ([c4654b4](https://github.com/oaslananka/boardreadyops/commit/c4654b47272ed12d2f839be61b7b3e14eeddfbba))

## [1.4.6](https://github.com/oaslananka/boardreadyops/compare/v1.4.5...v1.4.6) (2026-06-16)


### Bug Fixes

* **cli:** remove unused exports flagged by knip ([830415a](https://github.com/oaslananka/boardreadyops/commit/830415a108035c333b26483dd7243480fdf637b2))

## [1.4.5](https://github.com/oaslananka/boardreadyops/compare/v1.4.4...v1.4.5) (2026-06-15)


### Bug Fixes

* **deps:** resolve transitive npm audit findings ([47845c0](https://github.com/oaslananka/boardreadyops/commit/47845c037c29585fcedd9cd829bde2b2940c8dfb))
* **deps:** update esbuild to 0.28.1 to fix GHSA-gv7w-rqvm-qjhr (high) ([ef014e0](https://github.com/oaslananka/boardreadyops/commit/ef014e099150c32f94f77c487cce0b51d31ec048))
* resolve CHANGELOG, pnpm 11.5.3, action output paths, refresh docs ([f4ab558](https://github.com/oaslananka/boardreadyops/commit/f4ab558da52726054fb6f9e1bc0e3872b0a20a7f))


### Code Refactoring

* **cli,report,docs:** split oversized modules, retire kicad plugin, refresh release docs ([936ec68](https://github.com/oaslananka/boardreadyops/commit/936ec68b53eb88306b8ab3a3437202b1c405bd88))

## [1.4.4](https://github.com/oaslananka/boardreadyops/compare/v1.4.3...v1.4.4) (2026-06-09)


### Bug Fixes

* add --repo flag to gh workflow run in release-please to avoid dispatch failure ([3190ec0](https://github.com/oaslananka/boardreadyops/commit/3190ec0973e37c21bf4ec0ac2e19823b57b70bed))
* **ci:** use INPUT_* env vars, align Node 24, build local tarball for PRs ([b5d85ba](https://github.com/oaslananka/boardreadyops/commit/b5d85ba4c9abecfd8a81871cca71ab63f25f7103))


### Documentation

* update stale version references to v1.4.3 ([6f66c4b](https://github.com/oaslananka/boardreadyops/commit/6f66c4b0f62af264cd594f3965906c51cedf6616))


### CI

* align branch protection ruleset with live GitHub configuration ([c1eb9e3](https://github.com/oaslananka/boardreadyops/commit/c1eb9e3053a11f3e157dd10f4a32150bd51fdd75))

## [1.4.3](https://github.com/oaslananka/boardreadyops/compare/v1.4.2...v1.4.3) (2026-06-05)


### Bug Fixes

* **ci:** restore npm publish release handoff ([#120](https://github.com/oaslananka/boardreadyops/issues/120)) ([45c41a0](https://github.com/oaslananka/boardreadyops/commit/45c41a05180148a09e1a5343d5d0ebb84778aada))
* **ci:** skip floating tags for manual npm backfills ([6fcb644](https://github.com/oaslananka/boardreadyops/commit/6fcb644301c7f53b6efffc3df0a585fe2ffefd2a))
* **ci:** support historical npm backfills ([#121](https://github.com/oaslananka/boardreadyops/issues/121)) ([0975629](https://github.com/oaslananka/boardreadyops/commit/0975629a260d90e245411b24e011cf220739bb94))
* regenerate dist bundles and release history for v1.4.2 ([#112](https://github.com/oaslananka/boardreadyops/issues/112)) ([4dd98c5](https://github.com/oaslananka/boardreadyops/commit/4dd98c5c8889815378e4d85a37fded76c0965479))

## [1.4.2](https://github.com/oaslananka/boardreadyops/compare/v1.4.1...v1.4.2) (2026-06-04)


### Bug Fixes

* regenerate dist bundles and release history for v1.4.1 ([2734365](https://github.com/oaslananka/boardreadyops/commit/2734365f459a7efdc0c5082bfd31de392f46270a))

## [1.4.1](https://github.com/oaslananka/boardreadyops/compare/v1.4.0...v1.4.1) (2026-06-03)


### Bug Fixes

* restore Unreleased section in CHANGELOG.md ([1c0da85](https://github.com/oaslananka/boardreadyops/commit/1c0da8525e5de5d3dc6cd75523f82e9dc93d8f61))
* restore Unreleased section in CHANGELOG.md ([05fbc8d](https://github.com/oaslananka/boardreadyops/commit/05fbc8d347d070b4afb6a43469839679d45d98ea))
* simulate unavailable kicad-cli in gate requirement test ([c19c0fc](https://github.com/oaslananka/boardreadyops/commit/c19c0fca85b1feb0e25fc863dfe1e9e29e78ee18))
* simulate unavailable kicad-cli in gate requirement test ([69d26b5](https://github.com/oaslananka/boardreadyops/commit/69d26b5d5e5547dd9acae2b6d110521df8d521b4))


### CI

* add branch protection ruleset for main ([a21a4ef](https://github.com/oaslananka/boardreadyops/commit/a21a4efc43b4418bdb55ac7551aec511a0691d67))
* add branch protection ruleset for main ([9f0367c](https://github.com/oaslananka/boardreadyops/commit/9f0367c2cc3f8ea94e7f2bae3eb7cfe2a90a842f))
* add branch protection ruleset for main ([#107](https://github.com/oaslananka/boardreadyops/issues/107)) ([a21a4ef](https://github.com/oaslananka/boardreadyops/commit/a21a4efc43b4418bdb55ac7551aec511a0691d67))

## [1.4.0](https://github.com/oaslananka/boardreadyops/compare/v1.3.0...v1.4.0) (2026-06-03)

### Features

- **cli:** define stable JSON diagnostics contract with status and exitCode ([b90be1a](https://github.com/oaslananka/boardreadyops/commit/b90be1af705127f3e7841a948b8d466891358292))

### Bug Fixes

- align UV_VERSION in publish-npm.yml and disable prerelease in release-please-config ([c64f1e3](https://github.com/oaslananka/boardreadyops/commit/c64f1e33683ef717bf7cbac27beec6c50b4ec743))
- repair CHANGELOG Unreleased positioning and regenerate dist/docs ([b90be1a](https://github.com/oaslananka/boardreadyops/commit/b90be1af705127f3e7841a948b8d466891358292))
- repair CHANGELOG Unreleased positioning and regenerate dist/docs after release-please merge ([d83cfb4](https://github.com/oaslananka/boardreadyops/commit/d83cfb4c483c13e4db874cbd8c146d6bb15af552))
- skip kicad-plugin integration tests when plugin dir not present ([327deca](https://github.com/oaslananka/boardreadyops/commit/327decafca9614b1728a6c0ba93447fb2591784c))
- update action-inputs-docs generator source to v1.3.0 so gc passes ([aa49679](https://github.com/oaslananka/boardreadyops/commit/aa49679442cea76b993c2ca2e95d6ad6b104b30a))

### Code Refactoring

- split more-coverage.test.ts into domain-specific coverage files ([b86b10b](https://github.com/oaslananka/boardreadyops/commit/b86b10bc58afdb74cd5d36a4604b52bba23e7fec))

### CI

- **docs:** replace manual Pages deploy with actions/deploy-pages@v5.0.0 ([161e58c](https://github.com/oaslananka/boardreadyops/commit/161e58c53bde149b73da73d5ac2e065f3ab57ab9))
- pin all workflow runners from ubuntu-latest to ubuntu-24.04 ([f60294f](https://github.com/oaslananka/boardreadyops/commit/f60294f078a775a6c2c2b31d6751c339c3210895))
- remove 4 redundant workflow files consolidated into security.yml and ci.yml ([79706e5](https://github.com/oaslananka/boardreadyops/commit/79706e59a955a1d4db33670e55cf54b4b89344dd))
## [1.3.0](https://github.com/oaslananka/boardreadyops/compare/v1.2.3...v1.3.0) (2026-06-03)

### Features

- **cli:** define stable JSON diagnostics contract with status and exitCode ([#103](https://github.com/oaslananka/boardreadyops/issues/103)) ([8147a1d](https://github.com/oaslananka/boardreadyops/commit/8147a1dddd7bb8f4684e3b95a72e8dda05448cc2))

## [1.2.3](https://github.com/oaslananka/boardreadyops/compare/v1.2.2...v1.2.3) (2026-06-03)

### Bug Fixes

- stabilize v1.2.2 release CI (dist, KiCad metadata, CHANGELOG) ([adb7bb1](https://github.com/oaslananka/boardreadyops/commit/adb7bb190ea1981a48d6ce968999355e0bb526f2))

### CI

- **ci:** add governance workflow concurrency ([b1a735e](https://github.com/oaslananka/boardreadyops/commit/b1a735ed27e81aa9f34e96ea1ccc0f0a9ed03f51)), closes [#100](https://github.com/oaslananka/boardreadyops/issues/100)

## [1.2.2](https://github.com/oaslananka/boardreadyops/compare/v1.2.1...v1.2.2) (2026-06-02)

### Bug Fixes

- stabilize v1.2.1 release automation ([#95](https://github.com/oaslananka/boardreadyops/issues/95)) ([3b493dd](https://github.com/oaslananka/boardreadyops/commit/3b493ddca01e7b01964697db66896ee7169eba13)), closes [#89](https://github.com/oaslananka/boardreadyops/issues/89)

### Documentation

- Normalize release history, generated plugin SDK API docs, and stale-doc verification ([#50](https://github.com/oaslananka/boardreadyops/issues/50)).

### CI

- Update UV_VERSION 0.9.14 to 0.11.16 ([#58](https://github.com/oaslananka/boardreadyops/issues/58)).
- Upgrade pnpm 11.1.3 to 11.3.0 ([#60](https://github.com/oaslananka/boardreadyops/issues/60)).
- Remove KiCad 9.x from integration and container matrices ([#59](https://github.com/oaslananka/boardreadyops/issues/59)).
- Enforce zizmor advisory scan by removing `continue-on-error` ([#61](https://github.com/oaslananka/boardreadyops/issues/61)).
- Extract docs Python dependencies to `docs/requirements.txt` ([#62](https://github.com/oaslananka/boardreadyops/issues/62)).

## [1.2.1](https://github.com/oaslananka/boardreadyops/compare/v1.2.0...v1.2.1) (2026-06-02)

### Bug Fixes

- **ci:** normalize compatibility matrix drift ([#82](https://github.com/oaslananka/boardreadyops/issues/82)) ([793e8ce](https://github.com/oaslananka/boardreadyops/commit/793e8cee6ac54ea438ef3f6544b5a21b01f261f7))

### Documentation

- plan docs toolchain lifecycle ([#86](https://github.com/oaslananka/boardreadyops/issues/86)) ([fe20a0e](https://github.com/oaslananka/boardreadyops/commit/fe20a0e75017df427008450893ee0f069025ea95))
- **release:** normalize release history and sdk api ([#87](https://github.com/oaslananka/boardreadyops/issues/87)) ([d5e0bad](https://github.com/oaslananka/boardreadyops/commit/d5e0badc822f899935e757bb58bdcb015ddd1744))

### Tests

- **ci:** stabilize Vitest timeout on Windows ([#81](https://github.com/oaslananka/boardreadyops/issues/81)) ([d38c8b1](https://github.com/oaslananka/boardreadyops/commit/d38c8b15aa70a50dc0b2cf55722e7e2070afec79))

## [1.2.0](https://github.com/oaslananka/boardreadyops/compare/v1.1.0...boardreadyopsv1.2.0) (2026-05-30)

### CI

- Add manual npm publish dispatch and release-tag retry paths ([11113be](https://github.com/oaslananka/boardreadyops/commit/11113be50f0d9b257321e3c54e2dff888858572b), [2132170](https://github.com/oaslananka/boardreadyops/commit/21321705df4f15c029af833b098775127a87dab6), [6b9b9e0](https://github.com/oaslananka/boardreadyops/commit/6b9b9e0d439de3c5bc657f0649bdd6698cdf2578)).
- Make npm publish retry idempotent and harden manual tag repair ([7aacbed](https://github.com/oaslananka/boardreadyops/commit/7aacbed67550e5da29d130082ec1e56194a2f205), [a791ffe](https://github.com/oaslananka/boardreadyops/commit/a791ffed7ce6dbba694c088185985dd230d2429a)).
- Add manual container publish dispatch for already-published versions ([704b2ec](https://github.com/oaslananka/boardreadyops/commit/704b2ec82794f69f69e485f9929d56e718cd3f79)).

### Documentation

- Record v1.1.0 package parity verification ([#69](https://github.com/oaslananka/boardreadyops/issues/69)).

### Dependencies

- Update knip to v6.14.2 and pin dependency versions ([#71](https://github.com/oaslananka/boardreadyops/issues/71), [3724c78](https://github.com/oaslananka/boardreadyops/commit/3724c787a953ad8653f6b37a4c87f6141bd9b366)).
- Update non-major Vitest and coverage packages to v4.1.7 ([#76](https://github.com/oaslananka/boardreadyops/issues/76)).

### Maintenance

- Refresh generated NOTICE artifacts after dependency updates ([f56bfac](https://github.com/oaslananka/boardreadyops/commit/f56bfac33ad3a633ed062c955ab526775769cfa8), [7e4cbba](https://github.com/oaslananka/boardreadyops/commit/7e4cbba3eead4c1078b2a3d16866abb85087c7aa)).

## [1.1.0](https://github.com/oaslananka/boardreadyops/compare/v1.0.2...v1.1.0) (2026-05-26)

### Features

- Add fabrication diffs in PR comments and validate the GitHub Action marketplace listing ([0d9dc32](https://github.com/oaslananka/boardreadyops/commit/0d9dc3281abe0139e2ab3113dbc6a83fe7fae817), [85a4dc7](https://github.com/oaslananka/boardreadyops/commit/85a4dc7476f904c197853143597b4297dfdc2244)).
- Add CLI fix automation, doctor diagnostics, and i18n infrastructure ([dad705b](https://github.com/oaslananka/boardreadyops/commit/dad705b24b260ec15feb4da8d25ad36e1e529f81), [514d606](https://github.com/oaslananka/boardreadyops/commit/514d606f7010539f3981bcb8f00de32ce447b015), [#21](https://github.com/oaslananka/boardreadyops/issues/21)).
- Add finding remediation metadata, gate semantics, suppressions, baselines, structured logging, notifier hooks, and multi-project workspace support ([1bca167](https://github.com/oaslananka/boardreadyops/commit/1bca1679ad5b66f61e9d093975996b36b7bc6bb9), [8c8a9bf](https://github.com/oaslananka/boardreadyops/commit/8c8a9bf38d1ce531bb05cb3b21924e640803e65e), [846357f](https://github.com/oaslananka/boardreadyops/commit/846357f58bd59ea6b36b887d7366f42abdbbbd1f), [6b10f13](https://github.com/oaslananka/boardreadyops/commit/6b10f13d9d1145220742752871ff1ad62304630e), [c535bed](https://github.com/oaslananka/boardreadyops/commit/c535bed352458b819141aafe89fc9d0e11374630), [8c27166](https://github.com/oaslananka/boardreadyops/commit/8c271668e5da3e6b268dbfd9c8c0c66171342463)).
- Add plugin SDK and loader plus the KiCad PCM editor plugin ([0589294](https://github.com/oaslananka/boardreadyops/commit/0589294b424709bfa97c14da049c7b5fd1e563c3), [96eb42a](https://github.com/oaslananka/boardreadyops/commit/96eb42a0f90aabb610f4b08914ec9629ec9206d0)).
- Add binary distribution and full container Action release pipelines ([485c25c](https://github.com/oaslananka/boardreadyops/commit/485c25c0157f568a227b348910d485f4926f79ed), [71f83b0](https://github.com/oaslananka/boardreadyops/commit/71f83b0fe8ffa0e3fd1dad1c4c2842915d2654c8)).
- Add accessible HTML reports, CycloneDX hardware SBOM output, enriched SARIF context, richer rule metadata, and manufacturing output explanations ([#20](https://github.com/oaslananka/boardreadyops/issues/20), [#31](https://github.com/oaslananka/boardreadyops/issues/31), [#17](https://github.com/oaslananka/boardreadyops/issues/17), [0773732](https://github.com/oaslananka/boardreadyops/commit/0773732d1755deac2eff5513830604fd2ee9badd), [533938c](https://github.com/oaslananka/boardreadyops/commit/533938ce475225a92b2ca61fda0c7caea00ab652)).

### Bug Fixes

- Emit configured JUnit reports ([ee4846f](https://github.com/oaslananka/boardreadyops/commit/ee4846f133eda36f69eb3e45ba67feb41d2d6875)).

### Documentation

- Add license compliance notices, structure verifier documentation, and contributing governance docs ([6087066](https://github.com/oaslananka/boardreadyops/commit/6087066b0f53a87639ca2a75dff4c55c6fd1b464), [cf14cf7](https://github.com/oaslananka/boardreadyops/commit/cf14cf7d690997c259ae500c920f35ee284fc7d3), [95852af](https://github.com/oaslananka/boardreadyops/commit/95852af2dcd6dd55f24ce826fa461028a3cb74d8)).
- Record clean consumer channel verification, reference synchronization, and copy-paste audit gates ([5667f1b](https://github.com/oaslananka/boardreadyops/commit/5667f1b5ce14dbd8888fd3e919109abc76655f51), [4efcd6d](https://github.com/oaslananka/boardreadyops/commit/4efcd6d73e2e0de15a39c745b1a67e6c7a4f9ce0), [d3e74b0](https://github.com/oaslananka/boardreadyops/commit/d3e74b08607767743bde22f90efb1e0a1a5fa58b)).

### Tests

- Align CLI version expectations, add fixture regression coverage, cover cross-platform paths, enforce docs accessibility, and add coverage and mutation gates ([90478fc](https://github.com/oaslananka/boardreadyops/commit/90478fc27f9617f1ee3821002416cfe382c30c1c), [e692578](https://github.com/oaslananka/boardreadyops/commit/e6925782e7a28fd18fae48e64d6d88338351328e), [#19](https://github.com/oaslananka/boardreadyops/issues/19), [da3a370](https://github.com/oaslananka/boardreadyops/commit/da3a370ff78498bce4b198084551ea2d16ee5504), [9446b77](https://github.com/oaslananka/boardreadyops/commit/9446b7763277dfb666429ac0dca0138c1c9d1994)).

### CI

- Enforce compatibility matrix drift, action example pinning, Node version coverage, Scorecard publishing, Trivy pin repair, binary release asset hardening, and release self-validation ([#33](https://github.com/oaslananka/boardreadyops/issues/33), [02b55c5](https://github.com/oaslananka/boardreadyops/commit/02b55c590b214c2d70692834b7d46ed3d6fbbbba), [aa52ed6](https://github.com/oaslananka/boardreadyops/commit/aa52ed6c007f96fcade6914f0467b195c4cb143e), [800feb1](https://github.com/oaslananka/boardreadyops/commit/800feb195a1850f6a49942036513e2ae85b818d3), [d8e7ac4](https://github.com/oaslananka/boardreadyops/commit/d8e7ac4b082054d8f2e2ef02a67eecb5d1e16626), [a049987](https://github.com/oaslananka/boardreadyops/commit/a04998799b5fbf3cbdc42ced1204ed6422a1818d), [8e5bdbd](https://github.com/oaslananka/boardreadyops/commit/8e5bdbd3d128c5a84caf04475392773e403a1469), [42a4a5d](https://github.com/oaslananka/boardreadyops/commit/42a4a5d396914278c1e0f9e2c3bf47cd257a7052)).

## [1.0.2](https://github.com/oaslananka/boardreadyops/compare/v1.0.1...v1.0.2) (2026-05-21)

### Maintenance

- Refresh generated artifacts and mark the CLI bundle executable ([1cdcdcf](https://github.com/oaslananka/boardreadyops/commit/1cdcdcf), [c77df5c](https://github.com/oaslananka/boardreadyops/commit/c77df5c)).
- Align release metadata for v1.0.2 ([15e7890](https://github.com/oaslananka/boardreadyops/commit/15e7890), [9210bca](https://github.com/oaslananka/boardreadyops/commit/9210bca)).

## [1.0.1](https://github.com/oaslananka/boardreadyops/compare/v1.0.0...v1.0.1) (2026-05-21)

### Maintenance

- Normalize npm package metadata and publish the v1.0.1 package correction ([2cd39e6](https://github.com/oaslananka/boardreadyops/commit/2cd39e6), [02ff84a](https://github.com/oaslananka/boardreadyops/commit/02ff84a)).

## [1.0.0](https://github.com/oaslananka/boardreadyops/releases/tag/v1.0.0) (2026-05-21)

### Added

- Initial BoardReadyOps CLI and GitHub Action release for KiCad hardware production-readiness checks.
- KiCad DRC/ERC normalization, BOM checks, pinmap validation, manufacturing checks, design sanity checks, release preflight rules, and JSON/SARIF/Markdown/JUnit report outputs.
- Node 24 GitHub Action runtime, committed CLI/action bundles, coverage gates, mutation testing, property tests, SBOM generation, Gitleaks, OSV, CodeQL, Scorecard, Trivy, and npm provenance release workflows.
