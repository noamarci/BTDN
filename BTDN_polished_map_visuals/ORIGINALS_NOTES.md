# Bloons TD N — Original Towers: 3 paths x 5 tiers

All 14 original towers now use the same three-path / five-tier system as the 8 expansion towers (210 new upgrade tiers).
Code lives in `btd_originals.js` (new) and runs on top of `btd_expansion.js` (extended with small, additive hooks).

## Rules (same as the expansion)
- At most two paths can be upgraded; only one of them may go past tier 2 (5-2-0 ok, 3-3-0 not). Locked upgrades are greyed out with the reason.
- A tier can never be bought twice; money is deducted exactly once; sell value stays 70% of what you invested (Banana Salvage: 90%).
- Higher tiers replace the old single upgrade (Sharp Shots, Glaives, Tack Sprayer, Snap Freeze, Corrosive Glue, FMJ, Double Shot, Razor Rotors, Fireball, Laser Blasts, Larger Potions, Heavy Bombs, Greater Production, Jungle Drums are all now tiers inside the paths).

## Support / stacking rules
- Attack-speed buffs never stack: the strongest source (Village, Alchemist brew, Call to Arms, Sub support, Overclock, Dark Champion, Shinobi, Comanche Commander) wins.
- Damage / pierce / range / ceramic / blimp bonuses: strongest source per channel, never re-applied each frame; they vanish when the source is sold, out of range or timed out. They also work on the 8 expansion towers.
- Upgrade discounts (Monkey Commerce line) apply to upgrades of towers inside the Village radius; the best discount applies, no stacking.
- Abilities (Turbo Charge, Snowstorm, Glue Strike, Call to Arms, Supply Drop ...) fire automatically on a real cooldown, only while bloons are present, and show "ready in Ns" in the panel.
- Bloons here have no camo/lead/purple, so those BTD6 effects were replaced by working alternatives (pierce, ceramic/blimp damage, vulnerability marks, slows, stuns, income).

# Bloons TD N — Original Tower Upgrades (14 towers x 3 paths x 5 tiers = 210 upgrades)

Generated from the live definitions in `btd_originals.js`.

## Dart Monkey ($200)

**Path — Sharpness**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Sharp Shots | $140 | +2 pierce. |
| 2 | Razor Sharp Shots | $220 | +3 pierce, +1 damage vs ceramic. |
| 3 | Spike-o-pult | $650 | Hurls heavy spiked balls: +1 damage, 14 pierce, slower. |
| 4 | Juggernaut | $2,200 | Giant rolling ball: 3 damage, 24 pierce, +3 vs ceramic. |
| 5 | Ultra-Juggernaut | $16,000 | Colossal ball: 6 damage, 40 pierce. Splits into 6 balls when spent. |

**Path — Quick Shots**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Quick Shots | $100 | Throws 25% faster. |
| 2 | Very Quick Shots | $190 | Throws 25% faster again. |
| 3 | Triple Shot | $400 | Throws 3 darts in a fan. |
| 4 | Super Monkey Fan Club | $5,500 | Every 45s, 4 super monkeys fire at light speed for 10s. |
| 5 | Plasma Monkey Fan Club | $22,000 | Every 35s, 6 plasma monkeys blast bloons for 15s. |

**Path — Long Range**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Long Range Darts | $90 | +25 range. |
| 2 | Enhanced Eyesight | $200 | +20 range, +1 pierce, +1 vs ceramic. Darts steer a little. |
| 3 | Crossbow | $600 | Heavy bolts: +2 damage, +1 pierce, faster, far-flying. |
| 4 | Sharp Shooter | $2,400 | Faster crossbow. Gains +1 damage every round (max +6). |
| 5 | Crossbow Master | $12,000 | Brutal rate of fire: +3 damage, +3 pierce, +3 vs blimps. +2 damage per round. |

## Boomerang Monkey ($325)

**Path — Speed**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Faster Throwing | $150 | Throws 25% faster. |
| 2 | Faster Rangs | $300 | Throws 25% faster again. |
| 3 | Bionic Boomerang | $2,200 | Hurls at twice the speed: +1 pierce per throw, +2 pierce. |
| 4 | Turbo Charge | $4,500 | Every 30s: 6s of 4x throwing speed. Throws 2 boomerangs. |
| 5 | Perma Charge | $18,000 | Permanent turbo: 3 boomerangs, +2 damage, ultra fast. |

**Path — Glaives**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Improved Rangs | $200 | +3 pierce. |
| 2 | Glaives | $350 | Silver glaives: 12 pierce and +1 vs ceramic. |
| 3 | Glaive Ricochet | $1,800 | Glaives bounce on to 3 more nearby bloons. |
| 4 | M.O.A.R. Glaives | $4,500 | Huge glaives: +2 damage, +6 vs blimps, bigger hit area. |
| 5 | Glaive Lord | $13,000 | Three glaives orbit the Monkey, shredding anything near. +3 pierce. |

**Path — Range & Seeking**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Long Range Rangs | $100 | +25 range. |
| 2 | Red Hot Rangs | $250 | Hits set bloons on fire. +1 damage vs ceramic. |
| 3 | Kylie Boomerang | $1,200 | Seeking: boomerangs hunt down nearby bloons. Faster. |
| 4 | MOAB Press | $3,800 | Crushes blimps: +14 damage and knocks them back. |
| 5 | MOAB Domination | $16,000 | Seeking glaive swarm: +60 vs blimps, heavy knockback. Throws 2. |

## Bomb Shooter ($525)

**Path — Blast Power**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Bigger Bombs | $250 | +20 blast radius. |
| 2 | Heavy Bombs | $400 | +1 damage, hits 6 more bloons. |
| 3 | Really Big Bombs | $900 | +25 radius, +1 damage, hits 8 more bloons. |
| 4 | Bloon Impact | $3,200 | Bombs stun bloons (not blimps). +1 damage. |
| 5 | Bloon Crush | $14,000 | Colossal blasts: +6 damage, knockback, stun. Crushes blimps. |

**Path — Rapid Bombardment**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Faster Reload | $350 | Fires 25% faster. |
| 2 | Missile Launcher | $500 | Homing missiles: faster, longer range, quicker reload. |
| 3 | Frag Bombs | $1,500 | Bombs burst into 8 fragments that fly on and pop bloons. |
| 4 | Cluster Bombs | $4,800 | Bombs split into 4 smaller explosives. Fires faster. |
| 5 | Bomb Blitz | $18,000 | Recursive clusters + every 15s a blitz of 22 bombs on the strongest bloons. |

**Path — Heavy Artillery**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Extra Range | $250 | +30 range. |
| 2 | Heavy Artillery | $450 | +25 range, bombs fly faster, +1 damage vs ceramic. |
| 3 | MOAB Mauler | $1,800 | +14 damage to blimps. |
| 4 | MOAB Assassin | $4,000 | +45 damage vs blimps, blimps take extra damage. |
| 5 | MOAB Eliminator | $16,000 | +240 vs blimps. Blimps struck take heavy bonus damage from everything. |

## Tack Shooter ($280)

**Path — Volley**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Faster Shooting | $150 | Shoots 22% faster. |
| 2 | Even Faster Shooting | $250 | Shoots 25% faster again. |
| 3 | Tack Sprayer | $650 | Sprays 16 tacks per volley. |
| 4 | Overdrive | $3,000 | Blistering fire rate. +1 pierce. |
| 5 | The Tack Zone | $18,000 | 32 tacks at an insane rate. +1 damage, +2 pierce, +15 range. |

**Path — Blades**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Long Range Tacks | $100 | +20 range. |
| 2 | Super Range Tacks | $200 | +25 range, +1 pierce. |
| 3 | Blade Shooter | $600 | Fires razor blades: 2 damage, 5 pierce. |
| 4 | Blade Maelstrom | $2,800 | Every 16s, spinning blades orbit for 5s, shredding bloons. |
| 5 | Super Maelstrom | $16,000 | Permanent orbiting blade storm: 8 blades, +3 damage, +30 range. |

**Path — Inferno**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Hot Shots | $200 | Tacks set bloons on fire. |
| 2 | Hotter Shots | $400 | Stronger, longer burning. +1 pierce. |
| 3 | Ring of Fire | $1,100 | A ring of flames scorches every bloon around the tower. |
| 4 | Inferno Ring | $3,600 | Bigger, hotter ring. Tacks burn harder. +25 range. |
| 5 | Volcanic Eruption | $15,000 | Searing lava ring: 5 damage pulses, 16 burning tacks. Melts blimps. |

## Ice Monkey ($500)

**Path — Brittle Frost**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Permafrost | $100 | Bloons stay slowed for 3s after thawing. |
| 2 | Cold Snap | $225 | Pulses 15% faster, +10 range. |
| 3 | Ice Shards | $550 | Each pulse fires 8 piercing ice shards. |
| 4 | Embrittlement | $2,800 | Frozen bloons take +1 damage from every source for 6s. |
| 5 | Super Brittle | $15,000 | Bloons take +3 damage from all sources and 3 per pulse. Freezes harder. |

**Path — Deep Freeze**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Larger Radius | $150 | +22 freeze radius. |
| 2 | Enhanced Freeze | $300 | Freeze lasts 60% longer. |
| 3 | Arctic Wind | $1,600 | Permanent chill: bloons in range are always slowed, even between pulses. |
| 4 | Snowstorm | $3,500 | Every 25s a blizzard freezes every bloon on screen. |
| 5 | Absolute Zero | $18,000 | Every 25s: a deadly freeze-and-shatter across the whole map. Permanent deep chill. |

**Path — Cryo**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Re-Freeze | $150 | Pulses 25% faster, bloons re-freeze quickly. |
| 2 | Cold Reach | $350 | +20 range. Pulses also deal 1 damage (+1 vs ceramic). |
| 3 | Cryo Cannon | $1,400 | Every 2nd pulse also lobs a cryo shell at the strongest bloon. |
| 4 | Icicles | $3,800 | Frozen bloons take 2 damage per pulse. Cryo shells hit harder. |
| 5 | Icicle Impale | $16,000 | Frozen bloons take 6 per pulse; shells deal 18 and crush blimps. |

## Glue Gunner ($275)

**Path — Corrosion**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Stickier Glue | $100 | Glue lasts 50% longer. |
| 2 | Corrosive Glue | $450 | Glue eats at bloons: 1 damage every 0.5s. |
| 3 | Bloon Dissolver | $1,800 | Stronger acid: 2 damage every 0.5s, +2 vs ceramic. |
| 4 | Bloon Liquefier | $4,500 | Fast acid: 3 damage every 0.33s, +3 vs ceramic. |
| 5 | The Bloon Solver | $18,000 | Deadly acid: 6 every 0.33s, spreads to nearby bloons. Dissolves blimps. |

**Path — Splash**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Bigger Globs | $120 | Globs hit 2 bloons. |
| 2 | Glue Splatter | $400 | Globs splatter: glue every bloon in a small radius. |
| 3 | Glue Hose | $1,400 | Sprays glue much faster with a wider splash. |
| 4 | Glue Strike | $3,500 | Every 25s a strike glues every bloon on screen. |
| 5 | Glue Storm | $16,000 | Glue storm every 12s covers the whole map in strong, damaging glue. 3 globs per shot. |

**Path — Super Glue**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Stronger Glue | $200 | Glue slows by 60%. |
| 2 | Glue Soak | $500 | Glue soaks through: glued bloons take +1 damage from all sources. |
| 3 | MOAB Glue | $1,500 | Glue grips blimps much harder and lasts longer. |
| 4 | Relentless Glue | $3,800 | Heavy-duty glue lasts 10s; glued bloons take +2 from everything. |
| 5 | Super Glue | $16,000 | Bloons stuck almost solid (90% slow, even blimps); +4 damage from every source. |

## Sniper Monkey ($350)

**Path — Rapid Fire**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Fast Firing | $300 | Shoots 25% faster. |
| 2 | Even Faster Firing | $500 | Shoots 30% faster again. |
| 3 | Semi-Automatic | $3,200 | Rifle fires nearly 3x faster. +1 damage. |
| 4 | Full Auto Rifle | $5,500 | Fully automatic: more than twice as fast again. |
| 5 | Elite Defender | $15,000 | Fires at 2 targets at once. +3 damage, even faster. |

**Path — Crippling**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Full Metal Jacket | $350 | +2 damage, +1 vs ceramic. |
| 2 | Large Calibre | $600 | +3 damage. Shots stun bloons (not blimps). |
| 3 | Deadly Precision | $2,200 | +12 damage, +8 vs ceramic. Heavy hitter. |
| 4 | Maim MOAB | $2,800 | +40 vs blimps; blimps hit take +2 from every source. |
| 5 | Cripple MOAB | $18,000 | +320 vs blimps; blimps take +5 and are shoved back. |

**Path — Support**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Night Vision Goggles | $400 | Marks the target: it takes +1 damage from all sources for 4s. +1 pierce. |
| 2 | Shrapnel Shot | $900 | Bullets burst into shrapnel (radius 50). |
| 3 | Bouncing Bullet | $2,200 | Bullets ricochet to 3 more bloons. |
| 4 | Supply Drop | $4,500 | Every 25s a supply crate drops: +$300 cash. |
| 5 | Elite Sniper | $16,000 | +4 damage, 5 bounces, faster. Crates every 15s (+$700) and +$300/round. |

## Heli Pilot ($1000)

**Path — Gunship**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Quad Darts | $500 | Fires 4 darts at once. |
| 2 | Pursuit | $900 | Faster flight (+2) and +30% fire rate. |
| 3 | Razor Rotors | $1,500 | Rotors shred bloons the Heli flies over (1 damage / 0.25s). |
| 4 | Apache Dartship | $5,500 | 8 darts per volley at high speed, +1 damage. Stronger rotors. |
| 5 | Apache Prime | $22,000 | Homing 12-dart salvos, +2 damage, rotors cut through blimps. |

**Path — Missiles**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Bigger Jets | $400 | +1.5 flight speed, +15 range. |
| 2 | IFR | $700 | Every 4th volley launches a homing missile (explodes). |
| 3 | Downdraft | $1,800 | Rotor wash blasts bloons back every 4s. Missiles every 3rd volley. |
| 4 | MOAB Missiles | $4,500 | 3 heavy missiles every 2nd volley: +18 vs blimps. |
| 5 | Special Poperations | $20,000 | 4 elite escort helis + 6 giant missiles every volley. Devastating. |

**Path — Support Flight**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Faster Darts | $350 | Darts fly faster, +20 range. |
| 2 | Faster Firing | $500 | Fires 35% faster. |
| 3 | MOAB Shove | $1,500 | Darts shove blimps back. +4 damage vs blimps. |
| 4 | Comanche Defense | $5,000 | 2 Comanche escorts circle the Heli and fire darts. |
| 5 | Comanche Commander | $18,000 | 4 Comanches. Towers near the Heli fire 25% faster. +$350/round. |

## Ninja Monkey ($500)

**Path — Shuriken**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Ninja Discipline | $300 | Throws 25% faster. |
| 2 | Sharp Shuriken | $350 | +2 pierce, +1 vs ceramic. |
| 3 | Double Shot | $850 | Throws 2 shuriken at once. |
| 4 | Bloonjitsu | $2,800 | Throws 5 shuriken in a fan and faster. |
| 5 | Grandmaster Ninja | $20,000 | 8 homing shuriken at double speed. +2 damage, +3 pierce. |

**Path — Sabotage**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Seeking Shuriken | $300 | Shuriken steer towards bloons. +10 range. |
| 2 | Distraction | $500 | 25% of hits send bloons back and stop them briefly. |
| 3 | Shinobi Tactics | $2,500 | Ninjas within 150 attack 25% faster (incl. this one 15%). |
| 4 | Bloon Sabotage | $4,500 | Every 40s all bloons on screen are slowed by half for 6s. |
| 5 | Grand Saboteur | $18,000 | Every 30s: heavy slow, +2 damage taken and 6 damage to all. Aura 200. |

**Path — Bombs**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Caltrops | $250 | +15 range. Lays caltrops (spikes) on the track every 5s. |
| 2 | Flash Bomb | $1,100 | Every 4th throw lobs a flash bomb that stuns bloons. |
| 3 | Sticky Bomb | $3,000 | Bombs every 3rd throw: stun + 2 damage, +10 vs blimps, slows blimps. |
| 4 | Master Bomber | $5,500 | Every 2nd throw: huge bombs (4 damage, +20 vs blimps). |
| 5 | Bomb Barrage | $20,000 | Every throw is a giant bomb: 9 damage, +60 vs blimps. +3 caltrops. |

## Wizard Monkey ($400)

**Path — Fire**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Guided Magic | $250 | +15 range, +1 pierce, bolts home in better. |
| 2 | Fireball | $350 | Each bolt is followed by an exploding fireball (burns). |
| 3 | Wall of Fire | $1,100 | Every 7s conjures a burning patch on the track. |
| 4 | Dragon's Breath | $3,200 | Breathes a cone of fire at nearby bloons. Fireballs +1 damage. |
| 5 | Wizard Lord Phoenix | $20,000 | A phoenix hunts bloons for you; fireballs and breath are far stronger. |

**Path — Lightning**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Intense Magic | $200 | +20 range, +1 pierce. |
| 2 | Lightning Bolt | $600 | Every 3rd cast chains lightning through 4 bloons. |
| 3 | Arcane Mastery | $2,200 | Lightning every 2nd cast (6 bloons) + an arcane blast every 6s. |
| 4 | Archmage | $6,500 | Casts 40% faster; lightning every cast through 8 bloons for 3 damage. |
| 5 | Arcane Tempest | $20,000 | Storm lightning (12 bloons, 5 dmg) + a stunning mega blast every 4s. |

**Path — Necromancy**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Unholy Focus | $300 | +1 damage, casts 15% faster. |
| 2 | Necromancer | $900 | Every 9s raises up to 2 skeleton archers (20s each). |
| 3 | Unpopped Army | $2,800 | Raises 4 skeletons more often. |
| 4 | Skeletal Legion | $6,500 | 6 fast skeletons. Your bolts hit harder. |
| 5 | Prince of Darkness | $18,000 | 9 deadly skeletons + dark blasts every 5s. +3 damage. |

## Super Monkey ($2500)

**Path — Plasma**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Laser Blasts | $1,500 | Laser bolts: 2.5x speed, +2 pierce. |
| 2 | Plasma Vision | $3,000 | Plasma bolts: +3 pierce, +1 damage, slows bloons. |
| 3 | Sun Avatar | $6,500 | Fires a piercing solar beam. +1 damage. |
| 4 | Sun Temple | $14,000 | Three sun orbs orbit and scorch. Beam: +3 damage, wider. |
| 5 | True Sun God | $32,000 | Colossal sun beam (+7 dmg, 30 pierce) + 6 sun orbs. Obliterates everything. |

**Path — Range & Robo**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Super Range | $800 | +50 range. |
| 2 | Epic Range | $1,500 | +40 range, +1 pierce, +1 vs ceramic. |
| 3 | Robo Monkey | $4,500 | Fires at 2 different bloons at once. +1 damage. |
| 4 | Tech Terror | $12,000 | Robo fires at 3. Every 2s cyber beams strike 6 bloons for 8 damage. |
| 5 | The Anti-Bloon | $28,000 | 4 targets. Every 1.2s beams strike 16 bloons anywhere for 22 damage. |

**Path — Dark Knight**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Knockback | $1,200 | Darts knock bloons back along the track. |
| 2 | Ultravision | $2,500 | +35 range, +1 pierce. Targets take +1 damage from all sources. |
| 3 | Dark Knight | $6,000 | Sword slashes all bloons around it every 0.3s. +2 damage. |
| 4 | Dark Champion | $14,000 | Stronger slashes and a dark aura: nearby towers fire 20% faster, +1 pierce. |
| 5 | Legend of the Night | $32,000 | Night falls: EVERY tower fires 35% faster with +1 damage, +2 pierce. Massive slashes. |

## Alchemist ($395)

**Path — Acid**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Larger Potions | $250 | +25 blast radius, hits 3 more bloons. |
| 2 | Stronger Acid | $500 | Acid deals 2 damage and lasts 3s. |
| 3 | Perishing Potions | $1,800 | +1 damage, acid 3 dmg (+2 vs ceramic). |
| 4 | Unstable Concoction | $4,200 | Faster, +2 damage, stuns bloons, acid every 0.33s. |
| 5 | Total Transformation | $20,000 | Becomes a monster: 2x speed, +5 damage, acid that spreads between bloons. |

**Path — Brews**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Acidic Mixture Dip | $500 | Towers in range get +1 pierce and +1 vs ceramic (permanent aura). |
| 2 | Berserker Brew | $900 | Every 8s brews the 2 nearest towers: +30% speed, +1 damage for 12s. |
| 3 | Stronger Stimulant | $2,200 | 3 towers, 15s, +40% speed, +1 damage, +2 pierce. |
| 4 | Transforming Tonic | $5,500 | 4 towers, +100% speed. Alchemist itself +20% speed, +1 damage. |
| 5 | Permanent Brew | $20,000 | Every tower in a huge range: +45% speed, +2 damage, +3 pierce, +3 vs blimps - permanently. |

**Path — Alchemy**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Quick Brewing | $300 | Throws 30% faster. |
| 2 | Acid Pool | $600 | Potions leave an acid pool that damages bloons for 6s. |
| 3 | Lead to Gold | $1,800 | Every bloon hit by a potion pays +$1. |
| 4 | Rubber to Gold | $4,500 | Pays +$2 per bloon hit. 15% faster. |
| 5 | Bloon Master Alchemist | $17,000 | Pays +$3 per hit, +$400/round, big acid pools. 20% faster. |

## Banana Farm ($1250)

**Path — Production**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Increased Production | $500 | Grows bananas 20% faster. |
| 2 | Greater Production | $900 | Grows bananas 25% faster again. |
| 3 | Banana Plantation | $3,200 | 2 bananas per harvest, each worth 25% more. |
| 4 | Banana Research Facility | $11,000 | 3 bananas per harvest, more valuable, 15% faster. |
| 5 | Banana Central | $34,000 | 5 bananas per harvest, +40% value, 20% faster. Cash machine. |

**Path — Collection**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Long Life Bananas | $400 | Bananas last 25s before spoiling. |
| 2 | Valuable Bananas | $800 | Bananas are worth 40% more. |
| 3 | Monkey Bank | $3,500 | No clicking: cash goes into a vault, paid at round end with +20% interest. |
| 4 | IMF Loan | $11,000 | Vault interest +45%, bananas worth 20% more, +$400 each round. |
| 5 | Monkey-Nomics | $30,000 | Vault interest +90%, +30% value, +$1500 each round. |

**Path — Marketplace**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | EZ Collect | $350 | Bananas collect themselves after 1 second. |
| 2 | Banana Salvage | $800 | Sells for 90% of what you invested. +$60 per round. |
| 3 | Marketplace | $3,500 | +$300/round. Farms within 120 get +20% banana value. |
| 4 | Central Market | $12,000 | +$900/round. Farms within 150 get +50% value. Instant collection. |
| 5 | Monkey Wall Street | $38,000 | +$3500/round. Farms within 200 get +75% value. |

## Monkey Village ($1200)

**Path — Radius & Training**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Bigger Radius | $400 | +30 radius. |
| 2 | Radar Scanner | $900 | All towers in range gain +10% range. +10 radius. |
| 3 | Primary Training | $1,800 | Primary towers: +15% range, +1 pierce. |
| 4 | Primary Mentoring | $6,500 | Primary towers: +20% range, +1 damage, +2 pierce, 30% faster. |
| 5 | Primary Expertise | $20,000 | Primary: +30% range, +1 dmg, +4 pierce, 45% faster. All towers +15% range. |

**Path — Economy**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Monkey Business | $400 | +$120 every round. |
| 2 | Monkey Commerce | $1,200 | Upgrades cost 10% less for towers in the radius. |
| 3 | Monkey Town | $3,500 | +$300 per round, 15% upgrade discount. |
| 4 | Monkey City | $9,000 | +$700 per round, 20% upgrade discount. |
| 5 | Monkey Metropolis | $26,000 | +$2000 per round, 30% upgrade discount. |

**Path — Command**

| Tier | Upgrade | Price | Effect |
|---|---|---|---|
| 1 | Jungle Drums | $1,200 | Towers in range fire 35% faster (up from 20%). |
| 2 | Monkey Intelligence Bureau | $2,200 | Towers in range: +1 pierce, +1 vs ceramic and blimps. |
| 3 | Call to Arms | $5,500 | Every 40s, towers in range fire 45% faster for 8s. |
| 4 | Command Banner | $12,000 | Permanent 45% speed, +1 damage, +2 vs ceramic/blimps in range. Stronger Call to Arms. |
| 5 | Homeland Defense | $28,000 | Every 50s EVERY tower fires 2x faster with +1 damage for 10s. Permanent 50% speed. |

