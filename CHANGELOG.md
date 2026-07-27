# Changelog

## [0.3.0](https://github.com/korund/notemill-telegram/compare/v0.2.1...v0.3.0) (2026-07-27)


### Features

* **bucket:** stream audio into bucket instead of buffering in memory ([ae1c8d4](https://github.com/korund/notemill-telegram/commit/ae1c8d4618fa2762ee29c8ffcaac9e81284ad1a4))


### Bug Fixes

* **notifier:** recall language store entry on all result paths ([94824d3](https://github.com/korund/notemill-telegram/commit/94824d3c5d466df1b89a02ac96d4dacbc97d0648))
* **notifier:** remove AbortSignal listener leak in sleep() ([3deaca9](https://github.com/korund/notemill-telegram/commit/3deaca90616cb5ece2cc2bf47e91c00cb6528721))

## [0.2.1](https://github.com/korund/notemill-telegram/compare/v0.2.0...v0.2.1) (2026-05-21)


### Bug Fixes

* **build:** switch to NodeNext resolution and explicit index imports ([62b9b3b](https://github.com/korund/notemill-telegram/commit/62b9b3ba722390b58ce26ff436c2fb021fa860de))

## [0.2.0](https://github.com/korund/notemill-telegram/compare/v0.1.0...v0.2.0) (2026-05-21)


### Features

* **i18n:** per-user reply language via Telegram language_code ([78c4bd1](https://github.com/korund/notemill-telegram/commit/78c4bd119324b9fdd82c2b56f28be04d59eaca2e))
* **notifier:** handle NoSpeech result with reaction and reply ([5463c93](https://github.com/korund/notemill-telegram/commit/5463c9367d93afda40e0c6df66e6b37a3c04ffbb))
* **notifier:** tolerate unknown NotifyResult variants with diagnostic reply ([6dd215f](https://github.com/korund/notemill-telegram/commit/6dd215f9e1df45195045ab96469e4155c5694f7c))
