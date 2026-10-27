# GeoGuess birthday event fork

This fork is being developed for a one-off, host-led birthday game. The planning maximum is 50 guests; real-device capacity has not yet been rehearsed.

## Current status

The project retains the original Vue 2, Firebase Realtime Database, and Google Street View application. Admission, identity, and read-only presentation foundations are implemented; event-lobby integration is under development. The full host-led game—shared rounds, host controls, reveal, scoring, and final leaderboard—is not playable yet. Event readiness requires the remaining implementation and a real-device rehearsal.

No public deployment for this fork has been verified. The repository homepage still points to the upstream project, and GitHub Pages is not configured for this fork.

## Develop locally

Use Node 20 from `.nvmrc`, then install the locked dependencies:

```bash
npm ci
cp .env.dist .env.local
```

Copy `.env.dist` to an ignored `.env.local` and supply your own Google Maps and Firebase web-app settings. The variable names and optional settings are listed in `.env.dist`. Google Maps browser keys are included in built assets, so restrict them with provider controls. Never commit real configuration values or Firebase Admin credentials.

After filling in `.env.local`, start the development server with `npm run serve` and open the address printed in the terminal.

Useful checks:

```bash
NODE_ENV=production npm run lint -- --no-fix
npm run test:unit -- --runInBand
npm run build
```

## Project notes and public links

- [Requirements and acceptance criteria](docs/event-requirements.md)
- [Development setup and baseline evidence](docs/development-baseline.md)
- [Current state and gaps](docs/current-state-gap-analysis.md)
- [Implementation roadmap](docs/implementation-roadmap.md)
- [Documentation index](docs/README.md)
- [Issues](https://github.com/bottybotson/GeoGuess/issues) · [Pull requests](https://github.com/bottybotson/GeoGuess/pulls) · [Changelog](CHANGELOG.md) · [License](LICENSE)

This project is forked from [GeoGuess](https://github.com/GeoGuess/GeoGuess), itself forked from [GeoGuess Master Web](https://github.com/spider-hand/Geoguess-Master-Web). The original project’s contributors are credited below.

## Contribution

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for contribution information.

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/BilelJegham"><img src="https://avatars3.githubusercontent.com/u/20130405?v=4?s=100" width="100px;" alt="Bilel Jegham"/><br /><sub><b>Bilel Jegham</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=BilelJegham" title="Code">💻</a> <a href="#translation-BilelJegham" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://simonrousseau.me"><img src="https://avatars3.githubusercontent.com/u/19766429?v=4?s=100" width="100px;" alt="Simon"/><br /><sub><b>Simon</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=simonrousseau" title="Code">💻</a> <a href="#design-simonrousseau" title="Design">🎨</a> <a href="#translation-simonrousseau" title="Translation">🌍</a> <a href="https://github.com/GeoGuess/GeoGuess/pulls?q=is%3Apr+reviewed-by%3Asimonrousseau" title="Reviewed Pull Requests">👀</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dimfort"><img src="https://avatars3.githubusercontent.com/u/22171924?v=4?s=100" width="100px;" alt="dim.fort"/><br /><sub><b>dim.fort</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=dimfort" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/tululum"><img src="https://avatars2.githubusercontent.com/u/67554090?v=4?s=100" width="100px;" alt="tululum"/><br /><sub><b>tululum</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/issues?q=author%3Atululum" title="Bug reports">🐛</a> <a href="#translation-tululum" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/BurAndBY"><img src="https://avatars1.githubusercontent.com/u/48630651?v=4?s=100" width="100px;" alt="BurAndBY"/><br /><sub><b>BurAndBY</b></sub></a><br /><a href="#translation-BurAndBY" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://alexspelt.nl"><img src="https://avatars0.githubusercontent.com/u/39807948?v=4?s=100" width="100px;" alt="Alex Spelt"/><br /><sub><b>Alex Spelt</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/issues?q=author%3AAlexSpelt" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/chalbin73"><img src="https://avatars3.githubusercontent.com/u/59101580?v=4?s=100" width="100px;" alt="chalbin73"/><br /><sub><b>chalbin73</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/issues?q=author%3Achalbin73" title="Bug reports">🐛</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://viniciusdof.com"><img src="https://avatars.githubusercontent.com/u/6577961?v=4?s=100" width="100px;" alt="Vinicius Dell Osbel de Freitas"/><br /><sub><b>Vinicius Dell Osbel de Freitas</b></sub></a><br /><a href="#translation-viniciusdof" title="Translation">🌍</a> <a href="https://github.com/GeoGuess/GeoGuess/commits?author=viniciusdof" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://wlanowski.de"><img src="https://avatars.githubusercontent.com/u/25705332?v=4?s=100" width="100px;" alt="John Nitzsche"/><br /><sub><b>John Nitzsche</b></sub></a><br /><a href="#translation-wlanowski" title="Translation">🌍</a> <a href="#financial-wlanowski" title="Financial">💵</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://technicproblem.github.io"><img src="https://avatars.githubusercontent.com/u/38329398?v=4?s=100" width="100px;" alt="TechnicProblem"/><br /><sub><b>TechnicProblem</b></sub></a><br /><a href="#translation-TechnicProblem" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/maksovnik"><img src="https://avatars.githubusercontent.com/u/60991351?v=4?s=100" width="100px;" alt="maksovnik"/><br /><sub><b>maksovnik</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=maksovnik" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Stimmenhotel"><img src="https://avatars.githubusercontent.com/u/15821524?v=4?s=100" width="100px;" alt="Stimmenhotel"/><br /><sub><b>Stimmenhotel</b></sub></a><br /><a href="#translation-Stimmenhotel" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://crowdin.com/profile/jabbarmusin"><img src="https://crowdin-static.downloads.crowdin.com/avatar/14762568/large/a571d24c903f99fb222b289840695534.jpeg?s=100" width="100px;" alt="Cabbar Musin"/><br /><sub><b>Cabbar Musin</b></sub></a><br /><a href="#translation-jabbarmusin" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://crowdin.com/profile/jukefox"><img src="https://crowdin-static.downloads.crowdin.com/avatar/14626368/large/a84a666b450718b62ed469fd1a225acd.png?s=100" width="100px;" alt="M Treize"/><br /><sub><b>M Treize</b></sub></a><br /><a href="#translation-jukefox" title="Translation">🌍</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://crowdin.com/profile/thalissevero"><img src="https://www.gravatar.com/avatar/8ef7e5e3502f9816962a7d1536609dd6?s=260&d=https%3A%2F%2Fcrowdin.com%2Fimages%2Fuser-picture.png?s=100" width="100px;" alt="ThalisSevero"/><br /><sub><b>ThalisSevero</b></sub></a><br /><a href="#translation-ThalisSevero" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ElectableRuby31"><img src="https://avatars.githubusercontent.com/u/81558780?v=4?s=100" width="100px;" alt="ElectableRuby31"/><br /><sub><b>ElectableRuby31</b></sub></a><br /><a href="#translation-ElectableRuby31" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://crowdin.com/profile/raccort"><img src="https://crowdin-static.downloads.crowdin.com/avatar/13144827/large/a3efba5b13184b1e1318c2e06b0d3004.png?s=100" width="100px;" alt="raccort"/><br /><sub><b>raccort</b></sub></a><br /><a href="#translation-Andrea Cortesi" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://securitylive.com"><img src="https://avatars.githubusercontent.com/u/663211?v=4?s=100" width="100px;" alt="johnebgood"/><br /><sub><b>johnebgood</b></sub></a><br /><a href="#ideas-johnebgood" title="Ideas, Planning, & Feedback">🤔</a> <a href="#financial-johnebgood" title="Financial">💵</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://jae.fi"><img src="https://avatars.githubusercontent.com/u/76598503?v=4?s=100" width="100px;" alt="Jae Lo Presti"/><br /><sub><b>Jae Lo Presti</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=jae1911" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://eliteasian123.github.io/"><img src="https://avatars.githubusercontent.com/u/29520859?v=4?s=100" width="100px;" alt="EliteAsian"/><br /><sub><b>EliteAsian</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=EliteAsian123" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/itstechsupport"><img src="https://avatars.githubusercontent.com/u/62838020?v=4?s=100" width="100px;" alt="itstechsupport"/><br /><sub><b>itstechsupport</b></sub></a><br /><a href="#translation-itstechsupport" title="Translation">🌍</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://blog.tiga.tech"><img src="https://avatars.githubusercontent.com/u/10629864?v=4?s=100" width="100px;" alt="tigattack"/><br /><sub><b>tigattack</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=tigattack" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://troplo.com"><img src="https://avatars.githubusercontent.com/u/45160807?v=4?s=100" width="100px;" alt="Troplo"/><br /><sub><b>Troplo</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=Troplo" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/66Leo66"><img src="https://avatars.githubusercontent.com/u/33322229?v=4?s=100" width="100px;" alt="Leo Li"/><br /><sub><b>Leo Li</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=66Leo66" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://electrics01.com"><img src="https://avatars.githubusercontent.com/u/103579308?v=4?s=100" width="100px;" alt="ElectricS01"/><br /><sub><b>ElectricS01</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/pulls?q=is%3Apr+reviewed-by%3AElectricS01" title="Reviewed Pull Requests">👀</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/NitinRamnani"><img src="https://avatars.githubusercontent.com/u/16476523?v=4?s=100" width="100px;" alt="Nitin Ramnani"/><br /><sub><b>Nitin Ramnani</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=NitinRamnani" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://zhu.codes"><img src="https://avatars.githubusercontent.com/u/8866981?v=4?s=100" width="100px;" alt="Andrew Zhu"/><br /><sub><b>Andrew Zhu</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=zhudotexe" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/HelloJowet"><img src="https://avatars.githubusercontent.com/u/53214867?v=4?s=100" width="100px;" alt="Jonas Frei"/><br /><sub><b>Jonas Frei</b></sub></a><br /><a href="https://github.com/GeoGuess/GeoGuess/commits?author=HelloJowet" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!


## License

Licensed under the [MIT License](LICENSE).

## Contact

Use the [GitHub issues page](https://github.com/bottybotson/GeoGuess/issues) for feedback and project work.
