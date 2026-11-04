# 🐒 Monkey Run

A 3D endless temple runner for the browser. You play Coco the capuchin, who has just stolen the **Sun Banana** from the Temple of Kahu-Ra. The temple's jaguar Guardian is awake and chasing you. Run, jump, slide and turn along crumbling causeways above a misty jungle chasm.

Everything is generated in code: the 3D models, the rigged monkey and jaguar, every texture, the jungle, the music and the sound effects. The only third-party file is [three.js](https://threejs.org), included in `vendor/`.

## Play

The game uses ES modules, so serve the folder over HTTP rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static file server works (`npx serve`, `php -S`, GitHub Pages and so on).

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn at a corner / change lane | `←` `→` or `A` `D` | swipe left / right |
| Jump | `↑`, `W` or `Space` | swipe up |
| Slide (slam down if airborne) | `↓` or `S` | swipe down |
| Pause | `Esc` or `P` | ⏸ button |

At a junction, left/right turns you. Everywhere else it moves you one lane. You can press the turn a little early and it fires as soon as you reach the corner.

## Features

**The run**
- An endless, procedurally generated causeway with 90° left, right and T junctions. If you miss a turn, you hit a carved temple wall.
- Three lanes and 15 obstacle patterns that ramp up with distance: fallen logs, tangled roots, spike walls, stone arches, low branches, fire-jet traps, gaps, narrow one-lane bridges, pillars, boulders, monkey idol statues, rubble, slaloms and combos. An autopilot test runs 10 km without dying, so every pattern can be cleared.
- Speed builds from 14 to about 35 m/s. Jump length and slide length scale with speed, so timing stays fair.
- **The Guardian**: trip once and the jaguar is on your heels, roaring, with the screen edges pulsing red. Trip again before you shake it and you're caught. It follows your exact path, around corners too.
- Five ways to die, each with its own animation and death camera: crash, trip, burn, fall into the chasm, or get caught.

**Collectibles and power-ups**
- Bananas laid out in lines, lane-switching curves and arcs that trace the ideal jump. Rare golden bananas are worth 5.
- 🧲 **Banana Magnet**, 🛡️ **Jade Shield** (survives one crash or fall), ✖2 **Double Score** and ⚡ **Jungle Rush** (sprint, smash through obstacles and turn on your own).

**Progression**
- Bananas are your currency. Spend them in the **Trading Post** on 5 upgrade levels per power-up and **7 playable monkeys**, each with its own fur, face and accessories: Coco the Capuchin, Sunny the Golden Tamarin (mane), Yuki the Snow Macaque (scarf), Bongo the Explorer Chimp (fedora and satchel), Kage the Shadow Langur (ninja headband), Mandro the Mandrill and Rufus the Royal Gorilla (crown and cape).
- **Missions**: three active objectives across 12 types. Each one you finish adds +1 to your score multiplier, permanently.
- "Save me!" revives paid in bananas, with the cost doubling each time. Best score, records and settings are saved in `localStorage`.
- A tutorial on your first two runs shows a hint the first time you meet each kind of obstacle and corner.

**World and presentation**
- **Four biomes** that cross-fade every 1,000 m. Each has its own lighting, sky, fog, foliage and props:
  - *Emerald Jungle*: jungle trees with lianas
  - *Sunset Ruins*: palms, statues and columns
  - *Moonlit Temple*: stars, torch light, glowing mushrooms and fireflies
  - *Bamboo Mists*: bamboo groves in thick fog
- A procedural jungle that includes towering jungle trees, palms, bamboo, ferns, hanging vines, ruined colonnades, monkey shrines, carved gateways, stone piers dropping into the mist, flickering torches with real point lights, and distant mountains with a beacon-topped pyramid.
- A rigged monkey with procedural animation: run cycle, tucked jumps with the occasional spin, slides, stumbles, blinking, ear twitches, eyebrows and mouth expressions, and a tail that clutches the glowing Sun Banana. The jaguar has a rotary gallop with a flexing spine and an opening jaw.
- An intro where the Guardian roars out of the temple door while the camera swings round. The title screen has the jaguar lurking in the dark doorway.
- Particles: footstep dust, banana sparkles, falling leaves, fireflies, fire embers, smashed-rock debris, power-up bursts and speed lines.
- **Synthesized audio**: a tribal marimba and drum groove that speeds up as you run, a calmer menu theme, and every sound effect, including a little formant-synth "ook!" and a jaguar roar.
- High, medium and low graphics settings, shadow mapping, ACES tone mapping, and layouts for both mobile and desktop.

## Project layout

```
index.html        UI markup (screens, HUD, menus)
css/style.css     UI styling
js/main.js        bootstrap + loading screen
js/game.js        game loop, player physics, turning, collisions, chase, camera, scoring
js/world.js       track generator: layout of obstacles/bananas/power-ups, baked segment geometry
js/environment.js sky shader, biome lighting, fog, canopy, mist, mountains, torch lights
js/monkey.js      rigged monkey, skins, procedural animation
js/jaguar.js      the Guardian
js/particles.js   point-sprite particle systems
js/textures.js    procedural canvas textures (stone, masonry, glyphs, bark, fur, coat...)
js/shapes.js      procedural geometry (banana, fluted column, foliage, trunks, rocks...)
js/audio.js       Web Audio music sequencer + sound effects
js/save.js        persistence + missions
js/ui.js          menus, HUD, shop, FX overlay
js/input.js       keyboard + swipe input
js/config.js      tuning: speeds, biomes, power-ups, costs
vendor/           three.js r170 (MIT)
```

### Debug flags

- `?autopilot`: the monkey plays itself, which is useful for soak-testing.
- `?tutorial`: always show the tutorial hints.
