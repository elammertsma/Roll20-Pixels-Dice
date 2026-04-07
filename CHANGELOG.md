# Pixels Dice for Roll20
## Changelog

All notable changes to this project will be documented in this file.

## [3.3.0] - 2026-04-07

### Added
- **Auto-opening Popup**: The extension popup now automatically opens when you refresh a Roll20 editor page or switch back to an existing Roll20 tab.
- **Roll Failure Detection**: If the extension cannot find the Roll20 chat input (e.g., if the page is still loading), a friendly error modal now appears in the popup.
- **Bluetooth Connection Guidance**: Added a dedicated modal in the Hub to handle Bluetooth "out of range" errors with specific retry instructions.

### Changed
- **Popup Dice Summary**: Disconnected dice are now filtered out of the summary list in the popup for a cleaner interface.
- **Deselect Modifiers**: You can now click an already selected Stat, Save, or Skill in the popup to deselect it.

### Fixed
- Fixed an issue where the D20 remained in the popup summary even when the physical die was turned off or disconnected.

---

## [3.2.3] - 2026-04-06

Major update shifting to React, overhauling the UI, and introducing the Pixels Hub.

### Added
- **Introduced the Pixels Hub**: A central Bluetooth bridge for managing dice, templates, and settings.
- **Improved Modifiers**: Added stat, save, and skill modifiers that are now front-and-center in the new UI.
- **Advantage/Disadvantage**: Support for sequential (1 die twice), simultaneous (2 dice), and mixed (1 die + digital die) rolls.
- **Custom Modifiers**: Added support for generic bonuses and custom toggles (e.g., "Rage" or "Bane").
- **Visual Feedback**: Added signal strength indicators, low battery warnings, and animated roll status in the Popup and Hub.
- **Roll Styling**: Added support for Roll20's automatic critical success and failure highlighting.
- **Community Support**: Added donate buttons in the Hub and Popup.

### Changed
- **Tech Stack Shift**: Migrated the extension structure to React for better maintainability and performance.
- **Simplified UI**: Overhauled the distribution of features; dice info and template editors have been moved from the Popup to the Hub.
- **Smart Hub Management**: The Hub now opens discretely in a tab to the right of Roll20 and automatically closes when the session ends.
- **High-Res Assets**: Upgraded the logo to a higher resolution version.

### Fixed
- **Connection Reliability**: Refactored Bluetooth session management to improve stability.
- **Chat Integration**: Fixed chat field focus and reliability issues for roll injection.
- **Styling**: Fixed roll styling in chat to better match native Roll20 digital rolls.
- **Persistence**: Implemented local storage for template selection and modifier configurations.
