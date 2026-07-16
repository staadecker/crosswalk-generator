# Crosswalk Generator

[![Test](https://github.com/staadecker/crosswalk-generator/actions/workflows/test.yml/badge.svg)](https://github.com/staadecker/crosswalk-generator/actions/workflows/test.yml)

[This website](https://staadecker.github.io/crosswalk-generator/) lets you build a mapping table (sometimes called a crosswalk or concordance table) between two hierarchical classification systems. Hierarchical classification systems are widely used to, for example, [organize](https://en.wikipedia.org/wiki/Library_of_Congress_Classification) [books](https://en.wikipedia.org/wiki/Dewey_Decimal_Classification), [define](https://en.wikipedia.org/wiki/North_American_Industry_Classification_System)  [industries](https://en.wikipedia.org/wiki/Statistical_Classification_of_Economic_Activities_in_the_European_Community), and [classify](https://en.wikipedia.org/wiki/International_Patent_Classification) [patents](https://en.wikipedia.org/wiki/Cooperative_Patent_Classification). When conflicting classification systems exist, mapping tables can help users move between both systems. For example, I built this tool to develop a mapping between the EXIOBASEv3 and NAICS 2022 industry classification systems as part of my Master's research at MIT.

All data stays on your device since processing is done locally, in your browser.

This was my first project trying out Claude Code. Virtually everything except for this README was written by Claude Code. I chose Svelte 5 for my software stack and configured Claude Code to develop an extensive software testing suite.

## License Notice

Copyright 2026 Martin Staadecker

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See the [LICENSE](LICENSE) file.
