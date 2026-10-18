/* =====================================================================
   Bloons TD N  —  Tower Expansion Pack  (btd_expansion.js)
   ---------------------------------------------------------------------
   Adds the 8 missing Bloons TD 6 towers to every map / difficulty file:
     Military : Monkey Sub, Monkey Buccaneer, Monkey Ace, Mortar Monkey,
                Dartling Gunner
     Magic    : Druid
     Support  : Spike Factory, Engineer Monkey
   Each new tower has 3 upgrade paths x 5 tiers (BTD6 crosspath rules),
   original Canvas artwork, and works with the existing economy, rounds,
   bloons and difficulty settings.

   The file is loaded AFTER each game's inline script and hooks the
   game's globals (Tower, drawEntity, updateGame, updateMainUI,
   isValidPlacement, drawPath ...) instead of rewriting them, so all the
   original towers / maps / rounds keep working untouched.

   Load with:  <script src="btd_expansion.js" data-map="classic"></script>
   data-map  = classic | end_of_road | monkey_meadow | town_center | skates | resort
   ===================================================================== */
(function () {
'use strict';

/* ------------------------------------------------------------------ *
 * 0. ENVIRONMENT
 * ------------------------------------------------------------------ */
const SCRIPT = document.currentScript;
const MAP = (SCRIPT && SCRIPT.dataset.map) || 'classic';
if (typeof TOWER_TYPES === 'undefined' || typeof Tower === 'undefined' || typeof damageBloon === 'undefined') {
    console.error('[BTDX] Base game not found - expansion not loaded.');
    return;
}
const START_LIVES = lives;
let NOW = 0;                                   // global tick counter (unit ticks)
const W = () => canvas.width, H = () => canvas.height;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const HAS_STUMP = typeof stump !== 'undefined' && typeof isLineIntersectingCircle === 'function';

/* Game-side fix: the hard difficulty of two maps spawns 'RedMOAB' but
   never defined it (TypeError at round 60+). Define it if missing.      */
if (typeof BLOON_TYPES !== 'undefined' && !BLOON_TYPES.RedMOAB) {
    BLOON_TYPES.RedMOAB = { color: '#cc0000', speed: 0.5, hp: 400, radius: 36, rbe: 1632, isBlimp: true, children: ['MOAB', 'MOAB'] };
}

/* ------------------------------------------------------------------ *
 * 1. PATH / GEOMETRY HELPERS
 * ------------------------------------------------------------------ */
const PATHLEN = [0];
for (let i = 1; i < path.length; i++) PATHLEN[i] = PATHLEN[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);

const PATH_PTS = [];                           // sampled on-screen points of the track
(function () {
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / 9));
        for (let k = 0; k < n; k++) {
            const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
            if (x > 6 && x < canvas.width - 6 && y > 6 && y < canvas.height - 6) PATH_PTS.push({ x, y, seg: i });
        }
    }
})();

function prog(b) {                             // distance travelled along the track
    const i = clamp(b.waypointIndex, 1, path.length - 1), p = path[i - 1];
    return PATHLEN[i - 1] + Math.hypot(b.x - p.x, b.y - p.y);
}
function strength(b) {
    const T = BLOON_TYPES[b.type];
    return (T ? T.rbe : 1) + (b.isBlimp ? b.hp * 3 : 0);
}
function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function distToTrack(x, y) {
    let m = 1e9;
    for (let i = 1; i < path.length; i++) m = Math.min(m, segDist(x, y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y));
    return m;
}
function blockedLOS(x, y, b) {                 // tree-stump map: the trunk blocks direct fire
    return HAS_STUMP && isLineIntersectingCircle(x, y, b.x, b.y, stump.x, stump.y, stump.blockRadius);
}
function onScreen(b) { return b.x > -4 && b.x < W() + 4 && b.y > -4 && b.y < H() + 4; }
function lerpAngle(a, b, k) {
    let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * k;
}
/* where will bloon b be in `frames` ticks (follows the track) */
function predict(b, frames) {
    let x = b.x, y = b.y, i = b.waypointIndex;
    const sp = b.frozenTimer > 0 ? 0 : b.baseSpeed * (b.glueTimer > 0 ? b.glueSlow : 1);
    let d = sp * frames;
    while (d > 0 && i < path.length) {
        const tx = path[i].x, ty = path[i].y, dist = Math.hypot(tx - x, ty - y);
        if (dist > d) { x += (tx - x) / dist * d; y += (ty - y) / dist * d; d = 0; }
        else { x = tx; y = ty; d -= dist; i++; }
    }
    return { x, y };
}

/* ------------------------------------------------------------------ *
 * 2. WATER (naval towers)
 *    End-of-Road already has `pools`; the other maps get ponds.
 * ------------------------------------------------------------------ */
const OWN_PONDS = (function () {
    if (typeof pools !== 'undefined' && pools.length) return [];       // use the map's own water
    if (MAP === 'skates') return [{ x: 490, y: 415, r: 55 }, { x: 250, y: 150, r: 34 }];
    if (MAP === 'resort') return [{ x: 525, y: 400, r: 65 }];
    if (MAP === 'monkey_meadow') return [{ x: 415, y: 65, r: 34 }];
    if (MAP === 'town_center') return [{ x: 410, y: 75, r: 30 }];
    return [{ x: 170, y: 212, r: 46 }, { x: 390, y: 268, r: 64 }, { x: 575, y: 192, r: 40 }];   // classic
})();
function waterZones() {
    return OWN_PONDS.length ? OWN_PONDS.map(p => ({ x: p.x, y: p.y, r: p.r })) :
        (typeof pools !== 'undefined' ? pools.map(p => ({ x: p.x, y: p.y, r: p.radius })) : []);
}
function waterPlacementOK(x, y, radius) {
    if (x < radius || x > W() - radius || y < radius || y > H() - radius) return false;
    let inWater = false;
    for (const w of waterZones()) if (Math.hypot(x - w.x, y - w.y) + radius * 0.55 <= w.r) { inWater = true; break; }
    if (!inWater) return false;
    for (const t of towers) if (Math.hypot(x - t.x, y - t.y) < radius + t.radius) return false;
    return true;
}

/* ------------------------------------------------------------------ *
 * 3. TOWER DEFINITIONS + UPGRADES
 *    s = live stat block (rebuilt from base + owned upgrades)
 * ------------------------------------------------------------------ */
const COMMON = {
    range: 120, rate: 40, dmg: 1, pierce: 1, spd: 12, shots: 1, fan: 0, spread: 0.05, style: 'dart', pr: 4,
    ceramic: 0, blimp: 0, burn: null, slow: null, stun: 0, homing: 0, aoeDart: 0, beam: false, beamW: 0,
    rocket: null, chain: null, foam: null, burst: null, per: null, reactor: null, support: null, crew: null,
    sentry: null, overclock: null, trap: null, storm: null, income: 0, heal: 0
};
const mk = o => Object.assign(JSON.parse(JSON.stringify(COMMON)), o);
const R = (n) => Math.max(2, Math.round(n));
const per = (s, k, spec) => { s.per = Object.assign({}, s.per); s.per[k] = Object.assign({}, spec); };
/* Display-only Hebrew for U() labels and descriptions. The English source
   strings remain the keys passed by game data; costs and callbacks are untouched. */
const UPGRADE_HE = Object.freeze({
    'Sharp Shots':'חצים חדים','Powerful Darts':'חצים עוצמתיים','Razor Sharp Shots':'חצים חדים כתער',
    'Focused Firing':'ירי ממוקד','Laser Shock':'הלם לייזר','Laser Cannon':'תותח לייזר','Plasma Accelerator':'מאיץ פלזמה','Ray of Doom':'קרן האבדון',
    'Faster Barrel Spin':'סיבוב קנה מהיר','Hydra Rocket Pods':'משגרי רקטות הידרה','Rocket Storm':'סערת רקטות','M.A.D':'מ.א.ד','Armageddon Barrage':'מטח ארמגדון',
    'Bigger Blast':'פיצוץ גדול יותר','Bloon Impact':'פגיעת בלון','Bloon Crush':'ריסוק בלונים','Bloon Solver':'פותר הבלונים','Bloon Annihilation':'השמדת בלונים',
    'Faster Reload':'טעינה מהירה','Rapid Reload':'טעינה מהירה מאוד','Artillery Battery':'סוללת ארטילריה','Pop and Awe':'פיצוץ והלם','The Big One':'הגדול מכולם',
    'Increased Accuracy':'דיוק משופר','Burny Stuff':'חומר בעירה','Flaming Shells':'פגזים בוערים','Fire and Brimstone':'אש וגופרית','Hellfire Barrage':'מטח אש גיהינום',
    'Longer Range':'טווח ארוך יותר','Advanced Intel':'מודיעין מתקדם','Submerge and Support':'צלילה ותמיכה','Bloontonium Reactor':'כור בלונטוניום','Energizer':'ממריץ',
    'Barbed Darts':'חצים משוננים','Heat-seeking Missiles':'טילים עוקבי חום','Triple Guns':'תותחים משולשים','Armor Piercing Darts':'חצים חודרי שריון','Gatling Torpedoes':'טורפדות גטלינג',
    'Twin Guns':'תותחים תאומים','Airburst Darts':'חצים מתפוצצים באוויר','Pre-emptive Strike':'תקיפה מקדימה','Ballistic Missile':'טיל בליסטי','Doomsday Missile':'טיל יום הדין',
    'Faster Shooting':'ירי מהיר יותר','Double Shot':'ירייה כפולה','Destroyer':'משמיד','Aircraft Carrier':'נושאת מטוסים','Carrier Flagship':'ספינת הדגל של הנושאת',
    "Crow's Nest":'קן עורב','Cannon Ship':'ספינת תותחים','Monkey Pirates':'פיראטים קופים','Pirate Lord':'אדון הפיראטים','Grape Shot':'ירי ענבים','Hot Shot':'ירייה חמה','Merchantman':'סוחר ימי','Favored Trades':'עסקאות מועדפות','Trade Empire':'אימפריית מסחר',
    'Rapid Fire':'אש מהירה','Lots More Darts':'הרבה יותר חצים','Fighter Plane':'מטוס קרב','Operation: Dart Storm':'מבצע: סערת חצים','Sky Shredder':'מגרסת שמיים',
    'Exploding Pineapple':'אננס מתפוצץ','Spy Plane':'מטוס ריגול','Bomber Ace':'אלוף מפציץ','Ground Zero':'נקודת אפס','Tsar Bomba':'פצצת הצאר','Sharper Darts':'חצים חדים יותר','Centered Path Navigation':'ניווט במסלול מרכזי','Neva-Miss Targeting':'כוונון לעולם-לא-מפספס','Spectre':'ספקטר','Flying Fortress':'מבצר מעופף',
    'Hard Thorns':'קוצים קשים','Thorn Swarm':'נחיל קוצים','Barrage of Thorns':'מטח קוצים','Thorn Storm':'סערת קוצים','Thorn Maelstrom':'מערבולת קוצים','Heart of Thunder':'לב הרעם','Druid of the Storm':'דרואיד הסערה','Ball Lightning':'ברק כדורי','Wrath of the Storm':'זעם הסערה','Superstorm':'סופת-על','Druidic Reach':'טווח דרואידי','Jungle\'s Bounty':'שפע הג׳ונגל','Spirit of the Forest':'רוח היער','Heart of the Forest':'לב היער','Avatar of Wrath':'אווטאר הזעם',
    'Bigger Stacks':'ערימות גדולות יותר','Even Bigger Stacks':'ערימות גדולות עוד יותר','Spiked Balls':'כדורים מחודדים','Spiked Mines':'מוקשים מחודדים','Super Mines':'מוקשי-על','Faster Production':'ייצור מהיר יותר','Even Faster Production':'ייצור מהיר עוד יותר','MOAB SHREDR':'מגרסת מואבים','Spike Storm':'סערת נעצים','Carpet of Spikes':'שטיח נעצים','Long Reach':'טווח הגעה ארוך','Smart Spikes':'נעצים חכמים','Hot Spikes':'נעצים לוהטים','Deadly Spikes':'נעצים קטלניים','Perma-Spike':'נעץ קבוע',
    'Sentry Gun':'תותח זקיף','Double Gun':'תותח כפול','Sentry Expert':'מומחה זקיפים','Sentry Champion':'אלוף הזקיפים','Sentry Battalion':'גדוד זקיפים','Cleansing Foam':'קצף ניקוי','Overclock':'אוברקלוק','Foam Cannon':'תותח קצף','Ultraboost':'אולטרה-בוסט','Master Engineer':'מהנדס ראשי','Sprockets':'גלגלי שיניים','Larger Service Area':'אזור שירות גדול יותר','Deconstruction':'פירוק','Bloon Trap':'מלכודת בלונים','Mech Walker':'מהלך מכני',
    'Spike-o-pult':'משגר כדורי נעצים','Juggernaut':'ג׳אגרנוט','Ultra-Juggernaut':'אולטרה-ג׳אגרנוט','Quick Shots':'יריות מהירות','Very Quick Shots':'יריות מהירות מאוד','Triple Shot':'ירייה משולשת','Super Monkey Fan Club':'מועדון מעריצי קוף-על','Plasma Monkey Fan Club':'מועדון מעריצי קוף פלזמה','Long Range Darts':'חצים לטווח ארוך','Enhanced Eyesight':'ראייה משופרת','Crossbow':'קשת מוצלבת','Sharpshooter':'קלע חד','Crossbow Master':'אמן הקשת המוצלבת',
    'Faster Rangs':'בומרנגים מהירים יותר','Improved Rangs':'בומרנגים משופרים','Bionic Boomerang':'בומרנג ביוני','Turbo Charge':'טעינת טורבו','Perma Charge':'טעינה קבועה','Glaive Ricochet':'ריקושט להב','Glaive Lord':'אדון הלהבים','Kylie Boomerang':'בומרנג קיילי','MOAB Press':'לחיצת מואב','MOAB Domination':'שליטת מואב','Extra Range':'טווח נוסף','Red Hot Rangs':'בומרנגים לוהטים','Bionic Augmentation':'שדרוג ביוני','Turbo Charge':'טעינת טורבו',
    'Bigger Bombs':'פצצות גדולות יותר','Heavy Bombs':'פצצות כבדות','Bloon Buster':'מחסל בלונים','MOAB Mauler':'מועך מואבים','MOAB Assassin':'מתנקש מואבים','Missile Launcher':'משגר טילים','Cluster Bombs':'פצצות מצרר','Recursive Cluster':'מצרר רקורסיבי','Bomb Blitz':'בליץ פצצות','Frag Bombs':'פצצות רסס','Extra Blast Radius':'רדיוס פיצוץ נוסף','Really Big Bombs':'פצצות גדולות באמת','The Biggest One':'הגדולה מכולן',
    'More Tacks':'עוד נעצים','Even More Tacks':'עוד יותר נעצים','Blade Shooter':'יורה להבים','Blade Maelstrom':'מערבולת להבים','Super Maelstrom':'מערבולת-על','Faster Shooting':'ירי מהיר יותר','Even Faster Shooting':'ירי מהיר עוד יותר','Ring of Fire':'טבעת אש','Inferno Ring':'טבעת תופת','Long Range Tacks':'נעצים לטווח ארוך','Super Range':'טווח-על',
    'Permafrost':'קיפאון עד','Re-Freeze':'הקפאה מחדש','Cryo Cannon':'תותח קריו','Snowstorm':'סופת שלגים','Absolute Zero':'אפס מוחלט','Cold Snap':'מכת קור','Arctic Wind':'רוח ארקטית','Polar Vortex':'מערבולת קוטב','Icicles':'נטיפי קרח','Icicle Impale':'שיפוד נטיפי קרח',
    'Stickier Glue':'דבק דביק יותר','Stronger Glue':'דבק חזק יותר','Moab Glue':'דבק מואב','Relentless Glue':'דבק חסר רחמים','Super Glue':'דבק-על','Bigger Globs':'גושי דבק גדולים יותר','Glue Splatter':'התזת דבק','Glue Hose':'צינור דבק','Glue Strike':'תקיפת דבק','Glue Storm':'סערת דבק','Corrosive Glue':'דבק מאכל','Bloon Liquefier':'ממיס בלונים','The Bloon Solver':'פותר הבלונים',
    'Full Metal Jacket':'מעטפת מתכת מלאה','Deadly Precision':'דיוק קטלני','Maim MOAB':'מואב פצוע','Cripple MOAB':'נכה מואב','Night Vision Goggles':'משקפי ראיית לילה','Shrapnel Shot':'ירי רסיסים','Bouncing Bullet':'קליע מקפץ','Supply Drop':'הצנחת אספקה','Elite Sniper':'צלף עילית',
    'Quad Darts':'ארבעה חצים','Pursuit':'מרדף','Razor Rotors':'רוטורים חדים כתער','Apache Dartship':'ספינת חצים אפאצ׳י','Apache Prime':'אפאצ׳י פריים','Bigger Jets':'סילונים גדולים יותר','IFR':'טיסת מכשירים','Downdraft':'זרם אוויר מטה','MOAB Missiles':'טילי מואב','Special Poperations':'מבצעי פופ מיוחדים','Faster Darts':'חצים מהירים יותר','Faster Firing':'ירי מהיר יותר','MOAB Shove':'דחיפת מואב','Comanche Defense':'הגנת קומאנצ׳י','Comanche Commander':'מפקד קומאנצ׳י',
    'Ninja Discipline':'משמעת נינג׳ה','Sharp Shuriken':'שוריקנים חדים','Bloonjitsu':'בלונג׳יטסו','Grandmaster Ninja':'נינג׳ה רב-אמן','Seeking Shuriken':'שוריקנים עוקבים','Distraction':'הסחת דעת','Shinobi Tactics':'טקטיקות שינובי','Bloon Sabotage':'חבלת בלונים','Grand Saboteur':'מחבל גדול','Caltrops':'קלטורופים','Flash Bomb':'פצצת הבזק','Sticky Bomb':'פצצה דביקה','Master Bomber':'מפציץ ראשי','Bomb Barrage':'מטח פצצות',
    'Guided Magic':'קסם מונחה','Fireball':'כדור אש','Wall of Fire':'חומת אש','Dragon\'s Breath':'נשימת דרקון','Wizard Lord Phoenix':'אדון הקוסמים פניקס','Intense Magic':'קסם עוצמתי','Lightning Bolt':'מכת ברק','Arcane Mastery':'שליטה ארקאנית','Archmage':'ארכימאג','Arcane Tempest':'סערה ארקאנית','Unholy Focus':'מיקוד לא קדוש','Necromancer':'נקרומנסר','Unpopped Army':'צבא שלא פוצץ','Skeletal Legion':'לגיון שלדים','Prince of Darkness':'נסיך האופל',
    'Laser Blasts':'פיצוצי לייזר','Plasma Vision':'ראיית פלזמה','Sun Avatar':'אווטאר השמש','Sun Temple':'מקדש השמש','True Sun God':'אל השמש האמיתי','Epic Range':'טווח אפי','Robo Monkey':'קוף רובוטי','Tech Terror':'אימת טכנולוגיה','The Anti-Bloon':'נגד-הבלון','Knockback':'הדיפה','Ultravision':'ראיית-על','Dark Knight':'אביר אפל','Dark Champion':'אלוף אפל','Legend of the Night':'אגדת הלילה',
    'Larger Potions':'שיקויים גדולים יותר','Stronger Acid':'חומצה חזקה יותר','Perishing Potions':'שיקויים מחסלים','Unstable Concoction':'רקיחה לא יציבה','Total Transformation':'שינוי צורה מוחלט','Acidic Mixture Dip':'טבילת תערובת חומצית','Berserker Brew':'שיקוי ברסרקר','Stronger Stimulant':'ממריץ חזק יותר','Transforming Tonic':'טוניקת שינוי צורה','Permanent Brew':'שיקוי קבוע','Quick Brewing':'רקיחה מהירה','Acid Pool':'בריכת חומצה','Lead to Gold':'עופרת לזהב','Rubber to Gold':'גומי לזהב','Bloon Master Alchemist':'אלכימאי אמן בלונים',
    'Increased Production':'ייצור מוגבר','Greater Production':'ייצור גדול יותר','Banana Plantation':'מטע בננות','Banana Research Facility':'מתקן מחקר בננות','Banana Central':'מרכז הבננות','Long Life Bananas':'בננות מאריכות ימים','Valuable Bananas':'בננות יקרות ערך','Monkey Bank':'בנק הקופים','IMF Loan':'הלוואת קרן המטבע','Monkey-Nomics':'כלכלת הקופים','EZ Collect':'איסוף קל','Banana Salvage':'הצלת בננות','Marketplace':'שוק','Central Market':'שוק מרכזי','Monkey Wall Street':'וול סטריט הקופים',
    'Bigger Radius':'רדיוס גדול יותר','Radar Scanner':'סורק מכ״ם','Primary Training':'אימון ראשי','Primary Mentoring':'חניכה ראשית','Primary Expertise':'מומחיות ראשית','Monkey Business':'עסקי קופים','Monkey Commerce':'מסחר קופים','Monkey Town':'עיר הקופים','Monkey City':'עיר קופים גדולה','Monkey Metropolis':'מטרופולין הקופים','Jungle Drums':'תופי הג׳ונגל','Monkey Intelligence Bureau':'לשכת המודיעין של הקופים','Call to Arms':'קריאה לנשק','Command Banner':'דגל פיקוד','Homeland Defense':'הגנת המולדת'
});
const UPGRADE_HE_WORDS = Object.freeze({
    a:'',an:'',the:'ה',and:'ו',or:'או',of:'של',to:'ל־',in:'ב־',on:'על',at:'ב־',for:'למשך',from:'מ־',with:'עם',by:'באמצעות',into:'לתוך',between:'בין',before:'לפני',after:'אחרי',each:'כל',every:'כל',all:'כל',any:'כל',this:'זה',that:'זה',their:'שלהם',your:'שלך',it:'הוא',its:'שלו',is:'הוא',are:'הם',becomes:'הופך ל־',become:'הופכים ל־',gets:'מקבל',gain:'מקבלים',gains:'מקבל',get:'מקבלים',add:'מוסיף',adds:'מוסיף',hit:'פוגע',hits:'פוגעים',strike:'פוגע',strikes:'פוגעות',attack:'תוקף',attacks:'תוקף',fire:'יורה',fires:'יורה',shoot:'יורה',shoots:'יורה',throws:'זורק',throw:'זרוק',launch:'משגר',launches:'משגר',drop:'מפיל',drops:'מפיל',deals:'גורם',deal:'גורמים',take:'מקבלים',takes:'מקבל',lasts:'נמשך',last:'נמשך',slow:'מאט',slows:'מאט',stun:'משתק',stuns:'משתק',freeze:'מקפיא',freezes:'מקפיא',burn:'שורף',burns:'שורף',explodes:'מתפוצץ',explode:'מתפוצצים',grows:'מגדל',growing:'גידול',earns:'מכניס',pays:'מעניק',restores:'משחזר',raises:'מזמן',lays:'מניח',leave:'משאירים',leaves:'משאיר',calls:'מזמן',flies:'טס',fly:'עפים',aimed:'מכוון',aim:'כוון',seek:'עוקבים',seeking:'עוקב',home:'עוקבים',chases:'רודף',shreds:'קורע',shred:'קורע',kills:'מחסל',pop:'מפוצץ',pops:'מפוצץ',damage:'נזק',dmg:'נזק',pierce:'חדירה',radius:'רדיוס',range:'טווח',speed:'מהירות',rate:'קצב',faster:'מהר יותר',slower:'לאט יותר',faster:'מהר יותר',stronger:'חזק יותר',bigger:'גדול יותר',larger:'גדול יותר',longer:'ארוך יותר',heavy:'כבד',huge:'עצום',giant:'ענק',colossal:'עצום',massive:'עצום',deadly:'קטלני',permanent:'קבוע',permanently:'לצמיתות',nearby:'סמוכים',nearest:'הקרובים ביותר',whole:'כולה',global:'כלל־מפת',screen:'מסך',map:'מפה',track:'מסלול',ground:'קרקע',airstrip:'מסלול טיסה',shot:'ירייה',shots:'יריות',volley:'מטח',volleys:'מטחים',salvo:'מטח',salvos:'מטחים',bolts:'קליעים',bolt:'קליע',ball:'כדור',balls:'כדורים',bullet:'קליע',bullets:'קליעים',rocket:'רקטה',rockets:'רקטות',torpedo:'טורפדו',torpedoes:'טורפדות',cannonball:'כדור תותח',cannonballs:'כדורי תותח',mine:'מוקש',mines:'מוקשים',spike:'נעץ',spikes:'נעצים',thorn:'קוץ',thorns:'קוצים',foam:'קצף',acid:'חומצה',glue:'דבק',fire:'אש',flame:'להבה',lightning:'ברק',storm:'סערה',blast:'פיצוץ',blasts:'פיצוצים',beam:'קרן',beams:'קרניים',laser:'לייזר',plasma:'פלזמה',sun:'שמש',dark:'אפל',night:'לילה',forest:'יער',jungle:'ג׳ונגל',banana:'בננה',bananas:'בננות',cash:'כסף',money:'כסף',value:'ערך',interest:'ריבית',income:'הכנסה',life:'חיים',lives:'חיים',round:'שלב',rounds:'שלבים',second:'שנייה',seconds:'שניות',targets:'מטרות',target:'מטרה',ceramic:'קרמיקה',bloon:'בלון',bloons:'בלונים',blimp:'ספינת־אוויר',blimps:'ספינות־אוויר',tower:'מגדל',towers:'מגדלים',darts:'חצים',dart:'חץ',shell:'פגז',shells:'פגזים',bomb:'פצצה',bombs:'פצצות',sentries:'זקיפים',sentry:'זקיף',skeleton:'שלד',skeletons:'שלדים',pirates:'פיראטים',pirate:'פיראט',plane:'מטוס',planes:'מטוסים',aircraft:'מטוסים',rotor:'רוטור',rotors:'רוטורים',banana:'בננה',bananas:'בננות',potions:'שיקויים',potion:'שיקוי',brews:'שיקויים',brew:'שיקוי',flying:'מעופף',burning:'בוער',explosive:'נפיץ',homing:'עוקב',piercing:'חודר',stunning:'משתק',frozen:'קפוא',strong:'חזק',fast:'מהיר',more:'יותר',less:'פחות',again:'שוב',twice:'פי שניים',once:'בבת אחת',only:'בלבד',not:'לא',no:'ללא',up:'עד',out:'החוצה',back:'לאחור',along:'לאורך',across:'לאורך',around:'מסביב',above:'מעל',below:'מתחת',anywhere:'בכל מקום',right:'בדיוק',directly:'ישירות',often:'בתדירות גבוהה יותר',quickly:'מהר',briefly:'בקצרה',itself:'עצמו',own:'משלהם',different:'שונים',other:'אחרים',first:'ראשון',one:'אחד',two:'שניים',three:'שלושה',four:'ארבעה',five:'חמישה',six:'שישה',seven:'שבעה',eight:'שמונה',nine:'תשעה',ten:'עשרה',monster:'מפלצת',world:'עולם',ending:'מחסלת',instant:'מיידית',dead:'מתה',perfectly:'בדיוק',accurate:'מדויק',great:'גדול',high:'גבוהה',tight:'צמוד',centered:'מרכזי',ultimate:'אולטימטיבי',extra:'נוסף',really:'באמת',very:'מאוד',even:'אפילו',much:'הרבה',lots:'הרבה',most:'הכי',better:'טוב יותר',well:'היטב',total:'כולל',full:'מלא',deep:'עמוק',cold:'קר',hot:'חם',red:'אדום',metal:'מתכת',supply:'אספקה',crate:'ארגז',vault:'כספת',clicking:'לחיצה',collect:'אוספות',collection:'איסוף',instant:'מיידי',cost:'עולה',upgrades:'שדרוגים',discount:'הנחה',training:'אימון',primary:'ראשיים',all:'כל',sources:'המקורות',aura:'הילה',increased:'מוגדל',advanced:'מתקדם',improved:'משופר',enhanced:'משופר',quick:'מהיר',rapid:'מהיר',super:'על',ultra:'אולטרה',master:'אמן',grand:'גדול',true:'אמיתי',epic:'אפי',legend:'אגדה',lord:'אדון',prince:'נסיך',champion:'אלוף',expert:'מומחה',engineer:'מהנדס',alchemist:'אלכימאי',ninja:'נינג׳ה',wizard:'קוסם',monkey:'קוף',monkeys:'קופים',druid:'דרואיד',phoenix:'פניקס',robo:'רובוטי',tech:'טכנולוגיה',terror:'אימה',sword:'חרב',slashes:'חיתוכים',slash:'חותך',conjures:'מזמן',wall:'קיר',dragon:'דרקון',breath:'נשיפה',magic:'קסם',arcane:'ארקאני',army:'צבא',legion:'לגיון',necromancer:'נקרומנסר',lead:'עופרת',gold:'זהב',rubber:'גומי',market:'שוק',bank:'בנק',loan:'הלוואה',radar:'מכ״ם',scanner:'סורק',business:'עסקים',commerce:'מסחר',city:'עיר',metropolis:'מטרופולין',command:'פיקוד',banner:'דגל',defense:'הגנה',arms:'נשק',call:'קריאה'
});
function hebrewUpgradeText(text) {
    if (UPGRADE_HE[text]) return UPGRADE_HE[text];
    return String(text)
        .replace(/\+([\d.,]+) damage/g, '+$1 נזק')
        .replace(/\+([\d.,]+) pierce/g, '+$1 חדירה')
        .replace(/\+([\d.,]+) range/g, '+$1 טווח')
        .replace(/\+([\d.,]+) radius/g, '+$1 רדיוס')
        .replace(/\+([\d.,]+) vs blimps/g, '+$1 נגד ספינות־אוויר')
        .replace(/\+([\d.,]+) vs ceramic/g, '+$1 נגד קרמיקה')
        .replace(/Fires ([\d.]+)% faster\./g, 'יורה ב־$1% מהר יותר.')
        .replace(/Attacks ([\d.]+)% faster\./g, 'תוקף ב־$1% מהר יותר.')
        .replace(/Every ([\d.]+)s/g, 'כל $1 שניות')
        .replace(/per round/g, 'לכל שלב')
        .replace(/bloons/g, 'בלונים').replace(/bloon/g, 'בלון').replace(/blimps/g, 'ספינות־אוויר').replace(/blimp/g, 'ספינת־אוויר')
        .replace(/darts/g, 'חצים').replace(/dart/g, 'חץ').replace(/missiles/g, 'טילים').replace(/missile/g, 'טיל')
        .replace(/bombs/g, 'פצצות').replace(/bomb/g, 'פצצה').replace(/shells/g, 'פגזים').replace(/shell/g, 'פגז')
        .replace(/towers/g, 'מגדלים').replace(/tower/g, 'מגדל').replace(/damage/g, 'נזק').replace(/pierce/g, 'חדירה').replace(/range/g, 'טווח')
        .replace(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g, word => UPGRADE_HE_WORDS[word.toLowerCase()] || '');
}
const U = (name, cost, desc, f) => ({ name: hebrewUpgradeText(name), cost, desc: hebrewUpgradeText(desc), f });

const DEFS = {};

/* ---------------- DARTLING GUNNER (Military, land) ---------------- */
DEFS.Dartling = {
    name: 'Dartling Gunner', cat: 'Military', cost: 800, radius: 16, color: '#556b2f', kind: 'gun', cursorAim: true, alwaysFire: true, muzzle: 24,
    blurb: 'Rapid-fire gatling. Can be aimed at your cursor.',
    base: mk({ range: 125, rate: 8, dmg: 1, pierce: 1, spd: 17, spread: 0.16, pr: 3.5 }),
    paths: [
        { name: 'Lasers', up: [
            U('Focused Firing', 350, 'Perfectly accurate shots. +15 range.', s => { s.spread = 0.03; s.range += 15; }),
            U('Laser Shock', 850, 'Lasers: faster, +2 pierce, slow bloons hit.', s => { s.style = 'laser'; s.pierce += 2; s.spd = 24; s.slow = { f: 0.6, t: 60 }; s.pr = 4.5; }),
            U('Laser Cannon', 2600, '+1 damage, +2 pierce, fires faster, +1 vs ceramic.', s => { s.dmg += 1; s.pierce += 2; s.rate = R(s.rate * 0.85); s.ceramic += 1; }),
            U('Plasma Accelerator', 9000, 'Plasma bolts at more than twice the speed. +1 damage.', s => { s.style = 'plasma'; s.rate = R(s.rate * 0.45); s.dmg += 1; s.range += 15; s.pierce += 2; s.pr = 5.5; }),
            U('Ray of Doom', 26000, 'Instant piercing death ray. Shreds blimps.', s => { s.beam = true; s.beamW = 7; s.style = 'beam'; s.rate = 4; s.dmg = 4; s.pierce = 20; s.blimp += 3; s.ceramic += 2; s.range += 20; }),
        ] },
        { name: 'Rockets', up: [
            U('Faster Barrel Spin', 450, 'Fires 33% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Hydra Rocket Pods', 900, 'Every 16th shot launches 3 homing rockets.', s => { s.rocket = { every: 16, n: 3, dmg: 1, aoe: 30, blimp: 2, spd: 9, homing: 0.12, style: 'rocket' }; }),
            U('Rocket Storm', 2800, 'Every 9th shot launches 5 stronger rockets.', s => { s.rocket = { every: 9, n: 5, dmg: 2, aoe: 34, blimp: 4, spd: 9, homing: 0.13, style: 'rocket' }; }),
            U('M.A.D', 8500, '6 rockets per salvo + a huge missile at the strongest bloon every 9s.', s => { s.rocket.n = 6; per(s, 'mad', { every: 540, count: 1, how: 'missile', style: 'bigmissile', dmg: 35, aoe: 80, blimp: 120, ceramic: 12, global: true, spd: 7 }); }),
            U('Armageddon Barrage', 24000, '8 burning rockets every 5th shot. 3 monster missiles every 5s.', s => { s.rocket = { every: 5, n: 8, dmg: 3, aoe: 40, blimp: 8, spd: 10, homing: 0.14, style: 'rocket', burn: { d: 1, t: 150, n: 30 } }; per(s, 'mad', { every: 300, count: 3, how: 'missile', style: 'bigmissile', dmg: 55, aoe: 95, blimp: 260, ceramic: 30, global: true, spd: 8 }); }),
        ] },
        { name: 'Heavy Darts', up: [
            U('Powerful Darts', 450, '+1 damage.', s => { s.dmg += 1; }),
            U('Depleted Uranium', 1200, '+3 pierce, +2 damage to ceramics.', s => { s.pierce += 3; s.ceramic += 2; s.pr += 0.5; }),
            U('Hail of Darts', 3000, 'Fires 3 darts per volley.', s => { s.shots = 3; s.fan = 0.28; }),
            U('Dart Storm', 9500, '5 darts per volley, twice the fire rate, +1 damage.', s => { s.shots = 5; s.fan = 0.45; s.rate = R(s.rate * 0.55); s.dmg += 1; s.ceramic += 2; }),
            U('Gatling Apocalypse', 24000, '7 darts per volley at insane speed. +1 damage, +6 pierce.', s => { s.shots = 7; s.fan = 0.7; s.rate = R(s.rate * 0.6); s.dmg += 1; s.pierce += 6; s.blimp += 4; }),
        ] },
    ]
};

/* ---------------- MORTAR MONKEY (Military, land) ---------------- */
DEFS.Mortar = {
    name: 'Mortar Monkey', cat: 'Military', cost: 750, radius: 16, color: '#6b5b3a', kind: 'mortar', muzzle: 16,
    blurb: 'Lobs shells onto bloons anywhere in its huge range.',
    base: mk({ range: 250, rate: 115, dmg: 1, minR: 55, aoe: 40, maxHit: 25, volley: 1, shellSpd: 6.5, jitter: 14, patch: null }),
    paths: [
        { name: 'Heavy Shells', up: [
            U('Bigger Blast', 400, '+14 blast radius.', s => { s.aoe += 14; }),
            U('Bloon Impact', 800, 'Shells stun bloons (not blimps).', s => { s.stun = 60; }),
            U('Bloon Crush', 1600, '+2 damage, +6 vs blimps, +6 radius.', s => { s.dmg += 2; s.blimp += 6; s.aoe += 6; }),
            U('Bloon Solver', 6000, '+3 damage, +14 radius, +3 vs ceramic.', s => { s.dmg += 3; s.aoe += 14; s.ceramic += 3; s.blimp += 10; }),
            U('Bloon Annihilation', 20000, 'Devastating shells: +12 damage, huge radius.', s => { s.dmg += 12; s.aoe += 26; s.blimp += 80; s.ceramic += 10; s.stun = 100; }),
        ] },
        { name: 'Barrage', up: [
            U('Faster Reload', 500, 'Fires 25% faster.', s => { s.rate = R(s.rate * 0.8); }),
            U('Rapid Reload', 700, 'Fires 33% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Artillery Battery', 3200, 'Fires 2 shells per volley.', s => { s.volley = 2; }),
            U('Pop and Awe', 9000, '3 shells per volley + a stunning mega-blast every 8s.', s => { s.volley = 3; per(s, 'awe', { every: 480, count: 1, how: 'shell', style: 'bigone', dmg: 6, aoe: 140, blimp: 20, stun: 150 }); }),
            U('The Big One', 32000, '4 shells per volley + a colossal shell every 10s.', s => { s.volley = 4; s.rate = R(s.rate * 0.8); per(s, 'big', { every: 600, count: 1, how: 'shell', style: 'bigone', dmg: 70, aoe: 150, blimp: 400, ceramic: 40, stun: 180 }); }),
        ] },
        { name: 'Incendiary', up: [
            U('Increased Accuracy', 300, '+35 range. Shells land dead-on.', s => { s.range += 35; s.jitter = 0; s.minR = 40; }),
            U('Burny Stuff', 600, 'Shells set bloons on fire.', s => { s.burn = { d: 1, t: 150, n: 30 }; }),
            U('Flaming Shells', 1500, 'Stronger, longer burning. +8 radius.', s => { s.burn = { d: 2, t: 240, n: 30 }; s.aoe += 8; }),
            U('Fire and Brimstone', 5500, 'Shells leave a burning crater on the ground.', s => { s.patch = { r: 34, life: 360, d: 2, every: 30 }; s.burn = { d: 3, t: 300, n: 30 }; }),
            U('Hellfire Barrage', 28000, 'Every 7s rains 10 fire shells on the bloons.', s => { per(s, 'hell', { every: 420, count: 10, how: 'shell', style: 'mortar', random: true, dmg: 5, aoe: 42, blimp: 6, burn: { d: 3, t: 300, n: 30 }, patch: { r: 34, life: 300, d: 2, every: 30 } }); }),
        ] },
    ]
};

/* ---------------- MONKEY SUB (Military, WATER) ---------------- */
DEFS.Sub = {
    name: 'Monkey Sub', cat: 'Military', cost: 325, radius: 17, color: '#d4aa20', kind: 'gun', water: true, muzzle: 20,
    blurb: 'Water only. Darts, missiles and a nuclear reactor.',
    base: mk({ range: 135, rate: 34, dmg: 1, pierce: 2, spd: 11 }),
    paths: [
        { name: 'Support', up: [
            U('Longer Range', 200, '+30 range.', s => { s.range += 30; }),
            U('Advanced Intel', 400, '+20 range, +1 pierce.', s => { s.range += 20; s.pierce += 1; }),
            U('Submerge and Support', 1100, 'Nearby towers attack 20% faster.', s => { s.support = { r: 130, jungle: false }; }),
            U('Bloontonium Reactor', 5500, 'Radiation pulses hit every bloon around the sub.', s => { s.reactor = { r: 85, every: 40, dmg: 2, blimp: 4 }; }),
            U('Energizer', 22000, 'Huge reactor pulses. Towers in range fire 35% faster.', s => { s.reactor = { r: 120, every: 20, dmg: 5, blimp: 12 }; s.support = { r: 175, jungle: true }; }),
        ] },
        { name: 'Armament', up: [
            U('Barbed Darts', 300, '+2 pierce.', s => { s.pierce += 2; }),
            U('Heat-seeking Missiles', 450, 'Every 3rd shot fires a homing missile.', s => { s.rocket = { every: 3, n: 1, dmg: 3, aoe: 22, blimp: 3, spd: 8, homing: 0.16, style: 'rocket' }; }),
            U('Triple Guns', 1600, 'Fires 3 darts per volley, missiles more often.', s => { s.shots = 3; s.fan = 0.3; s.rocket.every = 2; }),
            U('Armor Piercing Darts', 4500, '+2 damage, +3 vs ceramic, +3 pierce, faster.', s => { s.dmg += 2; s.ceramic += 3; s.pierce += 3; s.rate = R(s.rate * 0.8); }),
            U('Gatling Torpedoes', 16000, '5 homing darts per volley, 2 torpedoes every shot.', s => { s.shots = 5; s.fan = 0.5; s.rate = R(s.rate * 0.5); s.dmg += 1; s.homing = 0.1; s.rocket = { every: 1, n: 2, dmg: 5, aoe: 30, blimp: 8, spd: 9, homing: 0.16, style: 'rocket' }; }),
        ] },
        { name: 'Strike', up: [
            U('Twin Guns', 350, 'Fires 2 darts per volley.', s => { s.shots = 2; s.fan = 0.12; }),
            U('Airburst Darts', 500, 'Darts explode on impact.', s => { s.aoeDart = 26; }),
            U('Pre-emptive Strike', 1800, 'Every 5.5s a missile hits the strongest bloon in range.', s => { per(s, 'strike', { every: 330, count: 1, how: 'missile', style: 'missile', dmg: 8, aoe: 48, blimp: 14, spd: 9 }); }),
            U('Ballistic Missile', 12000, 'Global-range missile every 4s. Massive damage.', s => { per(s, 'strike', { every: 240, count: 1, how: 'missile', style: 'bigmissile', dmg: 30, aoe: 68, blimp: 60, ceramic: 12, global: true, spd: 8 }); }),
            U('Doomsday Missile', 28000, '2 colossal global missiles every 2.8s.', s => { per(s, 'strike', { every: 170, count: 2, how: 'missile', style: 'bigmissile', dmg: 75, aoe: 100, blimp: 260, ceramic: 35, global: true, spd: 9 }); }),
        ] },
    ]
};

/* ---------------- MONKEY BUCCANEER (Military, WATER) ---------------- */
DEFS.Buccaneer = {
    name: 'Monkey Buccaneer', cat: 'Military', cost: 500, radius: 18, color: '#8b5a2b', kind: 'gun', water: true, muzzle: 22,
    blurb: 'Water only. Broadsides, aircraft carrier and a trade empire.',
    base: mk({ range: 150, rate: 32, dmg: 1, pierce: 3, spd: 12 }),
    paths: [
        { name: 'Gunnery', up: [
            U('Faster Shooting', 300, 'Fires 33% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Double Shot', 500, 'Fires 2 darts per volley.', s => { s.shots = 2; s.fan = 0.14; }),
            U('Destroyer', 2000, '4-dart broadside, +1 damage.', s => { s.shots = 4; s.fan = 0.4; s.dmg += 1; s.rate = R(s.rate * 0.85); }),
            U('Aircraft Carrier', 9000, 'Aircraft bomb the bloons: 3 bombs every 5.5s.', s => { per(s, 'air', { every: 330, count: 3, how: 'bomb', style: 'bomb', dmg: 4, aoe: 48, blimp: 8, ceramic: 1 }); }),
            U('Carrier Flagship', 30000, '6 heavy bombs every 3.3s, stronger broadside.', s => { per(s, 'air', { every: 200, count: 6, how: 'bomb', style: 'bomb', dmg: 9, aoe: 56, blimp: 30, ceramic: 6 }); s.dmg += 1; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Cannons & Crew', up: [
            U('Long Range', 250, '+40 range.', s => { s.range += 40; }),
            U("Crow's Nest", 400, '+20 range, +2 pierce.', s => { s.range += 20; s.pierce += 2; }),
            U('Cannon Ship', 1100, 'Every 2nd shot fires an explosive cannonball.', s => { s.rocket = { every: 2, n: 1, dmg: 3, aoe: 36, blimp: 4, spd: 10, homing: 0.04, style: 'cannon' }; }),
            U('Monkey Pirates', 4500, 'Two pirates add their own dart fire.', s => { s.crew = { n: 2, rate: 28, dmg: 2, pierce: 3, blimp: 0 }; }),
            U('Pirate Lord', 19000, '4 pirates, a cannonball every shot, +25 range.', s => { s.crew = { n: 4, rate: 18, dmg: 3, pierce: 4, blimp: 2 }; s.rocket.every = 1; s.rocket.dmg = 5; s.rocket.aoe = 44; s.range += 25; }),
        ] },
        { name: 'Trade', up: [
            U('Grape Shot', 400, 'Every 4th shot is a 7-grape scatter blast.', s => { s.burst = { every: 4, n: 7, fan: 0.9, dmg: 1, pierce: 2 }; }),
            U('Hot Shot', 500, 'Shots set bloons on fire.', s => { s.burn = { d: 1, t: 150, n: 30 }; }),
            U('Merchantman', 800, 'Earns +$220 every round.', s => { s.income += 220; }),
            U('Favored Trades', 5000, '+$400 per round (total $620). Grape shot more often.', s => { s.income += 400; s.burst.every = 3; }),
            U('Trade Empire', 24000, '+$1,280 per round (total $1,900). Bigger scatter blasts.', s => { s.income += 1280; s.burst.n = 11; s.burst.dmg += 1; }),
        ] },
    ]
};

/* ---------------- MONKEY ACE (Military, land, air) ---------------- */
DEFS.Ace = {
    name: 'Monkey Ace', cat: 'Military', cost: 800, radius: 17, color: '#4682b4', kind: 'ace', muzzle: 0,
    blurb: 'Flies endless loops over its airstrip, strafing and bombing.',
    base: mk({ range: 205, orb: 120, wr: 85, pspd: 3.3, rate: 34, shots: 4, fan: 0.5, spread: 0.06, dmg: 1, pierce: 2, spd: 13, pr: 3.5 }),
    paths: [
        { name: 'Guns', up: [
            U('Rapid Fire', 350, 'Fires 43% faster.', s => { s.rate = R(s.rate * 0.7); }),
            U('Lots More Darts', 550, 'Fires 8 darts per volley.', s => { s.shots = 8; s.fan = 0.8; }),
            U('Fighter Plane', 1500, 'Faster plane, +1 damage, +1 pierce.', s => { s.dmg += 1; s.rate = R(s.rate * 0.75); s.pspd = 4.2; s.pierce += 1; }),
            U('Operation: Dart Storm', 7500, '14-dart volleys at high speed.', s => { s.shots = 14; s.fan = 1.2; s.rate = R(s.rate * 0.7); s.ceramic += 2; }),
            U('Sky Shredder', 26000, '20-dart volleys, +2 damage. Shreds blimps.', s => { s.shots = 20; s.fan = 1.6; s.rate = R(s.rate * 0.7); s.dmg += 2; s.blimp += 5; s.pierce += 2; }),
        ] },
        { name: 'Bombs', up: [
            U('Exploding Pineapple', 450, 'Drops an explosive pineapple every 2.8s.', s => { per(s, 'pine', { every: 170, count: 1, how: 'bomb', style: 'pine', dmg: 2, aoe: 40, blimp: 2, local: true }); }),
            U('Spy Plane', 700, '+20 range and +2 pierce.', s => { s.wr += 20; s.pierce += 2; }),
            U('Bomber Ace', 2800, 'Drops 2 strong bombs every 2.2s.', s => { per(s, 'pine', { every: 130, count: 2, how: 'bomb', style: 'bomb', dmg: 4, aoe: 52, blimp: 10, local: true }); }),
            U('Ground Zero', 9500, 'Drops a giant bomb anywhere on the map every 15s.', s => { per(s, 'zero', { every: 900, count: 1, how: 'bomb', style: 'bigbomb', dmg: 40, aoe: 120, blimp: 150, ceramic: 30, global: true }); }),
            U('Tsar Bomba', 27000, 'World-ending bomb every 12s + 3 bombs per run.', s => { per(s, 'zero', { every: 720, count: 1, how: 'bomb', style: 'nuke', dmg: 150, aoe: 230, blimp: 700, ceramic: 100, stun: 120, global: true }); s.per.pine.count = 3; }),
        ] },
        { name: 'Navigation', up: [
            U('Sharper Darts', 300, '+2 pierce, +1 vs ceramic.', s => { s.pierce += 2; s.ceramic += 1; }),
            U('Centered Path Navigation', 450, 'Flies a tight loop over the airstrip. Faster.', s => { s.orb = 60; s.wr += 10; s.pspd += 0.4; }),
            U('Neva-Miss Targeting', 1300, 'Neva-Miss targeting: +1 pierce.', s => { s.homing = 0.14; s.pierce += 1; }),
            U('Spectre', 9000, '10+ darts per volley, +2 damage, faster.', s => { s.shots = Math.max(s.shots + 4, 10); s.fan = Math.max(s.fan, 1.0); s.dmg += 2; s.rate = R(s.rate * 0.75); s.wr += 15; }),
            U('Flying Fortress', 28000, '+8 darts, +2 damage, exploding darts.', s => { s.shots += 8; s.dmg += 2; s.blimp += 6; s.aoeDart = 18; s.rate = R(s.rate * 0.8); }),
        ] },
    ]
};

/* ---------------- DRUID (Magic, land) ---------------- */
DEFS.Druid = {
    name: 'Druid', cat: 'Magic', cost: 400, radius: 16, color: '#2e8b57', kind: 'gun', muzzle: 18,
    blurb: 'Nature magic: thorns, lightning storms and a healing forest.',
    base: mk({ range: 125, rate: 42, dmg: 1, pierce: 3, spd: 9.5, shots: 3, fan: 0.5, spread: 0.04, style: 'thorn', pr: 4 }),
    paths: [
        { name: 'Thorns', up: [
            U('Hard Thorns', 200, '+2 pierce, +1 vs ceramic.', s => { s.pierce += 2; s.ceramic += 1; }),
            U('Thorn Swarm', 450, 'Attacks 54% faster.', s => { s.rate = R(s.rate * 0.65); }),
            U('Barrage of Thorns', 1600, '6 thorns per volley, +1 damage.', s => { s.shots = 6; s.fan = 1.1; s.dmg += 1; }),
            U('Thorn Storm', 8000, '9 thorns per volley, faster, +1 damage.', s => { s.shots = 9; s.fan = 1.8; s.rate = R(s.rate * 0.7); s.dmg += 1; }),
            U('Thorn Maelstrom', 22000, '16 thorns in all directions. +2 damage.', s => { s.shots = 16; s.fan = 6.0; s.rate = R(s.rate * 0.55); s.dmg += 2; s.pierce += 3; s.blimp += 3; s.range += 15; }),
        ] },
        { name: 'Storm', up: [
            U('Heart of Thunder', 350, 'Every 4th attack calls chain lightning (3 bloons).', s => { s.chain = { every: 4, n: 3, dmg: 2, link: 80, blimp: 0 }; }),
            U('Druid of the Storm', 900, 'Lightning every 2nd attack, 5 bloons. +15 range.', s => { s.chain = { every: 2, n: 5, dmg: 3, link: 90, blimp: 0 }; s.range += 15; }),
            U('Ball Lightning', 2400, 'Lightning every attack, 6 bloons, stuns.', s => { s.chain = { every: 1, n: 6, dmg: 3, link: 100, blimp: 0, stun: 20 }; }),
            U('Wrath of the Storm', 8500, 'Lightning hits 9 bloons for 5 damage.', s => { s.chain = { every: 1, n: 9, dmg: 5, link: 110, blimp: 3, ceramic: 2, stun: 30 }; }),
            U('Superstorm', 28000, 'Lightning rains from the sky across a huge area.', s => { s.storm = { every: 14, n: 3, dmg: 6, aoe: 46, range: 260, blimp: 15 }; s.chain = { every: 1, n: 12, dmg: 6, link: 120, blimp: 5, ceramic: 3, stun: 30 }; }),
        ] },
        { name: 'Nature', up: [
            U('Druidic Reach', 250, '+30 range.', s => { s.range += 30; }),
            U("Jungle's Bounty", 650, 'Earns +$90 every round.', s => { s.income += 90; }),
            U('Spirit of the Forest', 2200, 'Restores 2 lives per round. Thorns slow bloons.', s => { s.heal += 2; s.slow = { f: 0.7, t: 90 }; }),
            U('Heart of the Forest', 7500, '+3 lives and +$260 per round. Thorns slow more.', s => { s.heal += 3; s.income += 260; s.slow = { f: 0.55, t: 120 }; }),
            U('Avatar of Wrath', 26000, '+4 lives, +$700 per round. +3 damage, faster, +6 pierce.', s => { s.heal += 4; s.income += 700; s.dmg += 3; s.pierce += 6; s.rate = R(s.rate * 0.6); }),
        ] },
    ]
};

/* ---------------- SPIKE FACTORY (Support, land) ---------------- */
DEFS.Spike = {
    name: 'Spike Factory', cat: 'Support', cost: 1000, radius: 20, color: '#8d8d8d', kind: 'spike', muzzle: 0,
    blurb: 'Lays spike piles on the track that pop bloons.',
    base: mk({ range: 105, rate: 80, dmg: 1, pierce: 12, life: 1500, max: 18, mine: null, smart: false, dump: null, perma: false }),
    paths: [
        { name: 'Stacks', up: [
            U('Bigger Stacks', 450, 'Spike piles pop 20 bloons.', s => { s.pierce = 20; }),
            U('Even Bigger Stacks', 650, 'Spike piles pop 30 bloons.', s => { s.pierce = 30; }),
            U('Spiked Balls', 1200, '+1 damage, +12 pierce.', s => { s.dmg += 1; s.pierce += 12; }),
            U('Spiked Mines', 5500, 'Spikes become mines that explode on contact.', s => { s.mine = { aoe: 46, dmg: 5 }; s.max += 8; }),
            U('Super Mines', 24000, 'Gigantic explosive mines. Obliterates blimps.', s => { s.mine = { aoe: 90, dmg: 30 }; s.blimp += 60; s.ceramic += 10; }),
        ] },
        { name: 'Production', up: [
            U('Faster Production', 400, 'Produces 25% faster.', s => { s.rate = R(s.rate * 0.8); }),
            U('Even Faster Production', 600, 'Produces 43% faster.', s => { s.rate = R(s.rate * 0.7); }),
            U('MOAB SHREDR', 1900, '+8 damage to blimps, +1 vs ceramic.', s => { s.blimp += 8; s.ceramic += 1; s.rate = R(s.rate * 0.9); }),
            U('Spike Storm', 5000, 'Every 12s dumps 20 spike piles along the track.', s => { s.dump = { every: 720, n: 20 }; s.rate = R(s.rate * 0.85); }),
            U('Carpet of Spikes', 22000, 'Every 7s dumps 36 piles. +1 damage.', s => { s.dump = { every: 420, n: 36 }; s.dmg += 1; s.rate = R(s.rate * 0.6); s.max += 20; }),
        ] },
        { name: 'Reach', up: [
            U('Long Reach', 300, '+25 range.', s => { s.range += 25; }),
            U('Smart Spikes', 800, 'Spikes are laid right in front of the bloons.', s => { s.smart = true; s.pierce += 4; s.range += 10; }),
            U('Hot Spikes', 2000, 'Spikes set bloons on fire.', s => { s.burn = { d: 1, t: 150, n: 30 }; }),
            U('Deadly Spikes', 8000, '+2 damage, +10 pierce, +2 vs ceramic.', s => { s.dmg += 2; s.ceramic += 2; s.pierce += 10; s.burn = { d: 2, t: 200, n: 30 }; }),
            U('Perma-Spike', 30000, 'Permanent, enormous spike piles. +3 damage.', s => { s.perma = true; s.dmg += 3; s.pierce += 30; s.max += 10; s.blimp += 6; }),
        ] },
    ]
};

/* ---------------- ENGINEER MONKEY (Support, land) ---------------- */
DEFS.Engineer = {
    name: 'Engineer Monkey', cat: 'Support', cost: 400, radius: 16, color: '#e67e22', kind: 'gun', muzzle: 20,
    blurb: 'Nail gun, deployable sentries, overclock and foam.',
    base: mk({ range: 125, rate: 36, dmg: 1, pierce: 4, spd: 14, style: 'nail', pr: 3 }),
    paths: [
        { name: 'Sentries', up: [
            U('Sentry Gun', 500, 'Deploys up to 2 temporary sentry turrets.', s => { s.sentry = { max: 2, deploy: 420, life: 1500, rate: 48, dmg: 1, pierce: 3, range: 95, shots: 1 }; }),
            U('Double Gun', 500, 'Sentries fire 2 nails. Up to 3 sentries.', s => { s.sentry.shots = 2; s.sentry.max = 3; }),
            U('Sentry Expert', 2200, 'Faster, stronger sentries. Up to 4.', s => { Object.assign(s.sentry, { dmg: 2, rate: 34, max: 4, range: 105, deploy: 330 }); }),
            U('Sentry Champion', 7500, 'Sentries fire 3 nails, much faster. Up to 5.', s => { Object.assign(s.sentry, { dmg: 3, rate: 22, max: 5, shots: 3, pierce: 5, range: 115 }); }),
            U('Sentry Battalion', 24000, '7 minigun sentries, deployed rapidly.', s => { Object.assign(s.sentry, { dmg: 4, rate: 11, max: 7, shots: 3, pierce: 7, range: 130, deploy: 200 }); }),
        ] },
        { name: 'Technology', up: [
            U('Cleansing Foam', 400, 'Every 4th attack sprays slowing foam.', s => { s.foam = { every: 4, aoe: 44, slow: { f: 0.55, t: 120 }, dmg: 0 }; }),
            U('Overclock', 600, 'Every 15s overclocks the nearest tower (+35% speed).', s => { s.overclock = { every: 900, dur: 600, f: 0.65, n: 1, r: 140 }; }),
            U('Foam Cannon', 1800, 'Bigger, stronger foam, sprayed every 2nd attack.', s => { s.foam = { every: 2, aoe: 56, slow: { f: 0.4, t: 150 }, dmg: 1 }; }),
            U('Ultraboost', 7500, 'Overclocks 3 towers for 15s (+100% speed).', s => { s.overclock = { every: 700, dur: 900, f: 0.5, n: 3, r: 170 }; }),
            U('Master Engineer', 25000, 'Overclocks 6 towers, foam stuns and damages.', s => { s.overclock = { every: 420, dur: 1200, f: 0.4, n: 6, r: 230 }; s.foam = { every: 1, aoe: 68, slow: { f: 0.3, t: 180 }, dmg: 2, stun: 30 }; }),
        ] },
        { name: 'Machinery', up: [
            U('Sprockets', 350, 'Nail gun fires 25% faster.', s => { s.rate = R(s.rate * 0.8); }),
            U('Larger Service Area', 300, '+30 range.', s => { s.range += 30; }),
            U('Deconstruction', 1500, '+1 damage, +3 vs ceramic and blimps, +2 pierce.', s => { s.dmg += 1; s.ceramic += 3; s.blimp += 3; s.pierce += 2; }),
            U('Bloon Trap', 4500, 'Plants explosive traps on the track.', s => { s.trap = { every: 380, n: 2, dmg: 6, aoe: 48, blimp: 12, ceramic: 3 }; }),
            U('Mech Walker', 20000, 'Heavy nail cannon, +3 damage, deadlier traps.', s => { s.dmg += 3; s.rate = R(s.rate * 0.5); s.pierce += 4; s.range += 25; s.trap = { every: 240, n: 3, dmg: 14, aoe: 60, blimp: 30, ceramic: 8 }; }),
        ] },
    ]
};

/* Register with the game's tower table so the existing placement /
   economy / selling code treats the new towers like any other.          */
for (const k in DEFS) {
    const d = DEFS[k];
    TOWER_TYPES[k] = { cost: d.cost, range: d.base.range, fireRate: d.base.rate || 60, damage: d.base.dmg, color: d.color,
                       radius: d.radius, pierce: d.base.pierce || 1, isXT: true, water: !!d.water };
}

/* ------------------------------------------------------------------ *
 * 4. RUNTIME STATE + COMBAT HELPERS
 * ------------------------------------------------------------------ */
const SCALED_DT = false;
const XPS = [];                                // projectiles, missiles and shells in flight
const FX = [];                                 // visual effects
let BUFFERS = [];                              // support auras (Sub) applied to every tower
/* Extension points used by btd_originals.js (the 14 original towers' 3x5 upgrade paths) */
const EXT = { pre: [], post: [], round: [], overlay: [], step: {}, draw: {}, style: {}, fx: {}, price: null };

function addFx(o) { if (FX.length < 340) { o.max = o.life; FX.push(o); } }

function slowBloon(b, f, t) {
    if (b.isBlimp || b.hp <= 0) return;
    if (!(b.glueTimer > 0) || f <= b.glueSlow) { b.glueSlow = f; b.glueTimer = Math.max(b.glueTimer || 0, t); }
}
function burnBloon(b, bn) {
    if (b.hp <= 0) return;
    if (!b.xBurn || bn.d >= b.xBurn.d) b.xBurn = { d: bn.d, t: bn.t, n: bn.n || 30, c: bn.n || 30 };
    else b.xBurn.t = Math.max(b.xBurn.t, bn.t);
}
function applyStatus(b, o) {
    if (b.hp <= 0) return;
    if (o.apply) o.apply(b, o);
    if (o.slow) slowBloon(b, o.slow.f, o.slow.t);
    if (o.stun && !b.isBlimp) b.frozenTimer = Math.max(b.frozenTimer || 0, o.stun);
    if (o.burn) burnBloon(b, o.burn);
}
/* damage with the per-tower bonus vs ceramic / blimps, then statuses */
function hurt(b, d, o) {
    if (b.hp <= 0) return;
    let v = d;
    if (o) {
        if (o.ceramic && b.type === 'Ceramic') v += o.ceramic;
        if (o.blimp && b.isBlimp) v += o.blimp;
    }
    if (v > 0) damageBloon(b, v);
    if (o) applyStatus(b, o);
}

const PAL = {
    boom: ['#fff2b0', '#ff9a2e', '#ff4d1a'], foam: ['#ffffff', '#9ae6ff', '#4fc3f7'], nuke: ['#ffffff', '#ffe066', '#ff6b1a'],
    rad: ['#eaffd0', '#8aff4d', '#2e9e2e'], bolt: ['#ffffff', '#9fd8ff', '#3d8bff'], leaf: ['#eaffd0', '#7bd957', '#2e8b57'],
    mortar: ['#fff2b0', '#ffb347', '#d2691e']
};
function fxBoom(x, y, r, style) {
    const p = PAL[style] || PAL.boom;
    addFx({ k: 'flash', x, y, r: r * 0.85, life: 9, col: p[0] });
    addFx({ k: 'ring', x, y, r0: r * 0.2, r1: r, life: 16, col: p[1], w: 4 });
    addFx({ k: 'ring', x, y, r0: r * 0.1, r1: r * 0.7, life: 12, col: p[2], w: 3 });
    const n = Math.min(9, Math.round(r / 7));
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(1, 3.2); addFx({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 14, col: p[1] }); }
}
function explode(x, y, r, d, o) {
    o = o || {};
    const list = [], bl = bloons;
    for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.hp > 0 && Math.hypot(b.x - x, b.y - y) <= r + b.radius * 0.5) list.push(b);
    }
    const max = o.maxHit || 60;
    if (list.length > max) { list.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)); list.length = max; }
    for (const b of list) hurt(b, d, o);
    fxBoom(x, y, r, o.fx || 'boom');
    return list.length;
}

/* ---- target selection ---- */
function pickTarget(t, range, mode, o) {
    o = o || {};
    const x = o.x !== undefined ? o.x : t.x, y = o.y !== undefined ? o.y : t.y;
    const minR2 = o.minR ? o.minR * o.minR : 0, los = o.los;
    let best = null, bk = -1e18;
    const bl = bloons;
    for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.hp <= 0) continue;
        const dx = b.x - x, dy = b.y - y, d2 = dx * dx + dy * dy, rr = range + b.radius * 0.5;
        if (d2 > rr * rr || d2 < minR2) continue;
        if (!onScreen(b)) continue;
        if (los && blockedLOS(x, y, b)) continue;
        let k;
        switch (mode) {
            case 'last': k = -prog(b); break;
            case 'close': k = -d2; break;
            case 'strong': k = strength(b); break;
            default: k = prog(b);
        }
        if (k > bk) { bk = k; best = b; }
    }
    return best;
}
/* up to n targets (strongest / random), used by volleys, strikes, storms */
function pickMany(t, range, n, o) {
    o = o || {};
    const x = o.x !== undefined ? o.x : t.x, y = o.y !== undefined ? o.y : t.y, c = [];
    const bl = bloons;
    for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.hp <= 0 || !onScreen(b)) continue;
        if (!o.global) { const rr = range + b.radius * 0.5; if ((b.x - x) ** 2 + (b.y - y) ** 2 > rr * rr) continue; }
        if (o.minR && Math.hypot(b.x - x, b.y - y) < o.minR) continue;
        c.push(b);
    }
    if (!c.length) return c;
    if (o.random) { for (let i = c.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const tmp = c[i]; c[i] = c[j]; c[j] = tmp; } }
    else if (o.mode === 'first') c.sort((a, b) => prog(b) - prog(a));
    else c.sort((a, b) => strength(b) - strength(a));
    return c.slice(0, n);
}
function nearestBloon(x, y, r, skip) {
    let best = null, bd = r * r;
    for (const b of bloons) {
        if (b.hp <= 0 || (skip && skip.has(b))) continue;
        const d = (b.x - x) ** 2 + (b.y - y) ** 2;
        if (d < bd) { bd = d; best = b; }
    }
    return best;
}
function rateMul(t) {
    let m = t.buffedJungle ? 0.65 : (t.buffed ? 0.8 : 1);
    if (t.xOc && t.xOc.until > NOW) m = Math.min(m, t.xOc.f);
    if (t.xBuffRate && t.xBuffRate < m) m = t.xBuffRate;
    return m;
}

/* ---- projectiles ---- */
function mkDart(ox, oy, ang, s, o) {
    o = o || {};
    const spd = o.spd || s.spd, range = o.range || s.range;
    const p = {
        kind: 'proj', style: o.style || s.style, x: ox, y: oy, px: ox, py: oy,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, ang, spd,
        life: o.life || Math.ceil(range * 1.18 / spd) + 3,
        pierce: o.pierce !== undefined ? o.pierce : s.pierce, dmg: o.dmg !== undefined ? o.dmg : s.dmg,
        r: o.pr !== undefined ? o.pr : s.pr,
        ceramic: o.ceramic !== undefined ? o.ceramic : s.ceramic, blimp: o.blimp !== undefined ? o.blimp : s.blimp,
        burn: o.burn !== undefined ? o.burn : s.burn, slow: o.slow !== undefined ? o.slow : s.slow,
        stun: o.stun !== undefined ? o.stun : s.stun, homing: o.homing !== undefined ? o.homing : s.homing,
        aoe: o.aoe !== undefined ? o.aoe : s.aoeDart, tgt: o.tgt || null, hit: null, fx: o.fx || 'boom'
    };
    XPS.push(p);
    return p;
}
function stepProj(p) {
    if (p.homing) {
        let tg = p.tgt;
        if (!tg || tg.hp <= 0 || (p.hit && p.hit.has(tg))) { tg = nearestBloon(p.x, p.y, 280, p.hit); p.tgt = tg; }
        if (tg) {
            const want = Math.atan2(tg.y - p.y, tg.x - p.x), cur = Math.atan2(p.vy, p.vx);
            let d = ((want - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
            d = clamp(d, -p.homing, p.homing);
            const a = cur + d; p.vx = Math.cos(a) * p.spd; p.vy = Math.sin(a) * p.spd; p.ang = a;
        }
    }
    p.px = p.x; p.py = p.y; p.x += p.vx; p.y += p.vy;
    if (--p.life <= 0 || p.x < -50 || p.x > W() + 50 || p.y < -50 || p.y > H() + 50) { p.dead = true; return; }
    const bl = bloons, rr = p.r;
    for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.hp <= 0 || (p.hit && p.hit.has(b))) continue;
        const reach = b.radius + rr;
        if (Math.abs(b.x - p.x) > reach + 26 || Math.abs(b.y - p.y) > reach + 26) continue;
        if (segDist(b.x, b.y, p.px, p.py, p.x, p.y) > reach) continue;
        if (p.aoe > 0) { explode(p.x, p.y, p.aoe, p.dmg, p); p.exp = true; p.dead = true; return; }
        hurt(b, p.dmg, p);
        (p.hit || (p.hit = new Set())).add(b);
        if (--p.pierce <= 0) { p.dead = true; return; }
    }
}
function stepShell(p) {
    p.t++;
    const u = Math.min(1, p.t / p.T);
    p.x = p.sx + (p.tx - p.sx) * u; p.y = p.sy + (p.ty - p.sy) * u; p.z = Math.sin(u * Math.PI) * p.h;
    if (p.t >= p.T) {
        p.dead = true;
        if (p.done) { p.done(p); return; }
        explode(p.tx, p.ty, p.aoe, p.dmg, p);
        if (p.patch && p.owner) p.owner.patches.push({ x: p.tx, y: p.ty, r: p.patch.r, life: p.patch.life, d: p.patch.d, every: p.patch.every, c: 0, burn: p.burn });
    }
}
/* lobbed shell with target prediction */
function launchShell(t, ox, oy, b, k) {
    const dist = Math.hypot(b.x - ox, b.y - oy);
    const T = k.T || clamp(Math.round(dist / (k.shellSpd || 6.5)), 22, 90);
    const pr = predict(b, T), j = k.jitter || 0;
    const tx = clamp(pr.x + rnd(-j, j), 4, W() - 4), ty = clamp(pr.y + rnd(-j, j), 4, H() - 4);
    XPS.push({
        kind: 'shell', style: k.style || 'mortar', sx: ox, sy: oy, x: ox, y: oy, z: 0, tx, ty, t: 0, T, h: k.h || Math.min(70, 14 + dist * 0.18),
        dmg: k.dmg, aoe: k.aoe, ceramic: k.ceramic || 0, blimp: k.blimp || 0, stun: k.stun || 0, burn: k.burn || null, slow: k.slow || null,
        maxHit: k.maxHit, patch: k.patch || null, owner: t, fx: k.fx || (k.burn ? 'mortar' : 'boom'), done: k.done || null
    });
}
function launchMissile(t, ox, oy, b, k) {
    const a = Math.atan2(b.y - oy, b.x - ox) + rnd(-0.7, 0.7);
    mkDart(ox, oy, a, t.s, {
        style: k.style || 'missile', spd: k.spd || 9, life: 280, pierce: 1, dmg: k.dmg, aoe: k.aoe, pr: 5, ceramic: k.ceramic || 0, blimp: k.blimp || 0,
        burn: k.burn || null, slow: null, stun: k.stun || 0, homing: k.homing !== undefined ? k.homing : 0.14, tgt: b, fx: k.fx || 'boom'
    });
}
/* periodic specs (s.per): missiles, shells and bombs on a timer */
function launchSpec(t, ox, oy, b, k) {
    if (k.how === 'missile') launchMissile(t, ox, oy, b, k);
    else if (k.how === 'bomb') launchShell(t, ox, oy, b, Object.assign({ T: 24, h: 26 }, k));
    else launchShell(t, ox, oy, b, Object.assign({ jitter: 6 }, k));
}
function tickPeriodic(t, ox, oy, rm) {
    const P = t.s.per;
    if (!P) return;
    for (const key in P) {
        const k = P[key];
        let c = t.pcd[key];
        if (c === undefined) c = Math.round(k.every * 0.5);
        c -= 1 / rm;
        if (c <= 0) {
            const range = k.local ? t.s.wr * 1.15 : t.s.range;
            const list = pickMany(t, range, k.count, { x: ox, y: oy, global: !!k.global, random: !!k.random, mode: 'strong' });
            if (list.length) {
                for (let i = 0; i < k.count; i++) launchSpec(t, ox, oy, list[i % list.length], k);
                c = k.every;
            } else c = 12;
        }
        t.pcd[key] = c;
    }
}

/* ------------------------------------------------------------------ *
 * 5. TOWER BEHAVIOUR
 * ------------------------------------------------------------------ */
function fireBeam(t, ox, oy, a) {
    const s = t.s, L = s.range * 1.25, x2 = ox + Math.cos(a) * L, y2 = oy + Math.sin(a) * L, hits = [];
    for (const b of bloons) {
        if (b.hp <= 0) continue;
        if (segDist(b.x, b.y, ox, oy, x2, y2) <= b.radius + s.beamW) hits.push(b);
    }
    hits.sort((p, q) => Math.hypot(p.x - ox, p.y - oy) - Math.hypot(q.x - ox, q.y - oy));
    for (let i = 0; i < hits.length && i < s.pierce; i++) hurt(hits[i], s.dmg, s);
    addFx({ k: 'beam', x1: ox, y1: oy, x2, y2, life: 7, col: '#ff3b6b', w: 7 });
}
function chainLightning(t, ox, oy, first, k) {
    const hit = new Set(), pts = [{ x: ox, y: oy }];
    let cur = first;
    for (let i = 0; i < k.n && cur; i++) {
        hit.add(cur); pts.push({ x: cur.x, y: cur.y });
        const nx = cur.x, ny = cur.y;
        hurt(cur, k.dmg, k);
        let nxt = null, nd = k.link;
        for (const b of bloons) {
            if (b.hp <= 0 || hit.has(b)) continue;
            const d = Math.hypot(b.x - nx, b.y - ny);
            if (d < nd) { nd = d; nxt = b; }
        }
        cur = nxt;
    }
    addFx({ k: 'bolt', pts, life: 9, col: '#bfe6ff', w: 3 });
}
function fireRockets(t, ox, oy, tg) {
    const k = t.s.rocket;
    const list = pickMany(t, t.s.range * 1.1, k.n, { x: ox, y: oy, mode: 'first' });
    if (!list.length) list.push(tg);
    for (let i = 0; i < k.n; i++) launchMissile(t, ox, oy, list[i % list.length], k);
}

/* the shared "shooter" volley (Dartling, Sub, Buccaneer, Druid, Engineer, Ace) */
function volley(t, ox, oy, tg, aimAng) {
    const s = t.s;
    const a = aimAng !== undefined ? aimAng : Math.atan2(tg.y - oy, tg.x - ox);
    const mx = ox + Math.cos(a) * (t.xt.muzzle || 0), my = oy + Math.sin(a) * (t.xt.muzzle || 0);
    if (s.beam) fireBeam(t, mx, my, a);
    else {
        const n = s.shots;
        for (let i = 0; i < n; i++) {
            let off = n > 1 ? (i / (n - 1) - 0.5) * s.fan : 0;
            off += (Math.random() - 0.5) * s.spread;
            mkDart(mx, my, a + off, s);
        }
    }
    t.shots++; t.recoil = 1; t.spin = 1;
    if (s.rocket && t.shots % s.rocket.every === 0) fireRockets(t, mx, my, tg);
    if (s.chain && tg && t.shots % s.chain.every === 0) chainLightning(t, mx, my, tg, s.chain);
    if (s.burst && t.shots % s.burst.every === 0) {
        const b = s.burst;
        for (let i = 0; i < b.n; i++) mkDart(mx, my, a + (i / (b.n - 1) - 0.5) * b.fan, s, { style: 'grape', dmg: b.dmg, pierce: b.pierce, spd: s.spd * 0.9, range: s.range * 0.8 });
    }
    if (s.foam && tg && t.shots % s.foam.every === 0) {
        const f = s.foam;
        launchShell(t, mx, my, tg, { T: 18, h: 14, dmg: f.dmg, aoe: f.aoe, slow: f.slow, stun: f.stun || 0, style: 'foam', fx: 'foam', jitter: 4 });
    }
}

/* ---- auxiliary tickers ---- */
function tickReactor(t, rm) {
    const k = t.s.reactor;
    t.reactorC = (t.reactorC || 0) - 1 / rm;
    if (t.reactorC > 0) return;
    let any = false;
    for (const b of bloons) {
        if (b.hp > 0 && Math.hypot(b.x - t.x, b.y - t.y) <= k.r + b.radius * 0.4) { hurt(b, k.dmg, k); any = true; }
    }
    if (any) { addFx({ k: 'ring', x: t.x, y: t.y, r0: 10, r1: k.r, life: 16, col: '#8aff4d', w: 4 }); t.reactorC = k.every; }
    else t.reactorC = 6;
}
function tickCrew(t, rm) {
    const c = t.s.crew;
    t.crewC = (t.crewC || 0) - 1 / rm;
    if (t.crewC > 0) return;
    const list = pickMany(t, t.s.range, c.n, { random: true });
    if (!list.length) { t.crewC = 6; return; }
    for (let i = 0; i < c.n; i++) {
        const b = list[i % list.length], sx = t.x + rnd(-8, 8), sy = t.y + rnd(-8, 8);
        mkDart(sx, sy, Math.atan2(b.y - sy, b.x - sx), t.s, { dmg: c.dmg, pierce: c.pierce, blimp: c.blimp || 0, range: t.s.range, style: 'dart' });
    }
    t.crewC = c.rate;
}
function tickStorm(t, rm) {
    const k = t.s.storm;
    t.stormC = (t.stormC || 0) - 1 / rm;
    if (t.stormC > 0) return;
    const list = pickMany(t, k.range, k.n, { random: true });
    if (!list.length) { t.stormC = 8; return; }
    for (const b of list) {
        addFx({ k: 'bolt', pts: [{ x: b.x + rnd(-20, 20), y: -10 }, { x: b.x, y: b.y }], life: 10, col: '#d6efff', w: 4 });
        explode(b.x, b.y, k.aoe, k.dmg, { blimp: k.blimp, fx: 'bolt' });
    }
    t.stormC = k.every;
}
function pickTrackPoint(t, range, smart) {
    if (t.candR !== range) {
        t.cand = PATH_PTS.filter(p => Math.hypot(p.x - t.x, p.y - t.y) <= range);
        t.candR = range;
    }
    if (!t.cand.length) return null;
    if (smart) {
        const b = pickTarget(t, range + 40, 'first');
        if (b) { const pr = predict(b, 30); if (Math.hypot(pr.x - t.x, pr.y - t.y) <= range + 20) return { x: pr.x + rnd(-6, 6), y: pr.y + rnd(-6, 6) }; }
    }
    return t.cand[(Math.random() * t.cand.length) | 0];
}
function layPile(t, p, props) {
    const x = p.x, y = p.y;
    if (t.spikes.length >= props.max) t.spikes.shift();
    const o = Object.assign({ x, y, age: 0, hit: new Set(), rot: rnd(0, TAU), p0: props.mine ? 1 : Math.max(1, props.pierce) }, props);
    const sx = t.x, sy = t.y, T = 16;
    XPS.push({ kind: 'shell', style: 'toss', sx, sy, x: sx, y: sy, z: 0, tx: x, ty: y, t: 0, T, h: 22, owner: t, done: () => { t.spikes.push(o); } });
}
function tickTraps(t, rm) {
    const k = t.s.trap;
    t.trapC = (t.trapC || 0) - 1 / rm;
    if (t.trapC > 0 || !roundInProgress) return;
    for (let i = 0; i < k.n; i++) {
        const p = pickTrackPoint(t, t.s.range, false);
        if (p) layPile(t, p, { life: 1800, max: 12, pierce: 1, dmg: k.dmg, mine: { aoe: k.aoe, dmg: k.dmg }, ceramic: k.ceramic || 0, blimp: k.blimp || 0, burn: null, trap: true });
    }
    t.trapC = k.every;
}
function tickOverclock(t, rm) {
    const k = t.s.overclock;
    t.ocC = (t.ocC === undefined ? Math.round(k.every * 0.35) : t.ocC) - 1;
    if (t.ocC > 0) return;
    const c = towers.filter(o => o !== t && !o.isFarm && !o.isVillage && Math.hypot(o.x - t.x, o.y - t.y) <= k.r)
        .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y)).slice(0, k.n);
    if (c.length) {
        for (const o of c) {
            o.xOc = { until: NOW + k.dur, f: k.f };
            addFx({ k: 'ring', x: o.x, y: o.y, r0: 8, r1: 30, life: 22, col: '#ffd54a', w: 3 });
            addFx({ k: 'bolt', pts: [{ x: t.x, y: t.y }, { x: o.x, y: o.y }], life: 12, col: '#ffe680', w: 2 });
        }
        t.ocC = k.every;
    } else t.ocC = 30;
}
function tickSentries(t, rm) {
    const k = t.s.sentry, arr = t.sentries;
    for (let i = arr.length - 1; i >= 0; i--) {
        const e = arr[i];
        e.life--; e.cd--; if (e.flash > 0) e.flash--;
        if (e.life <= 0) { addFx({ k: 'puff', x: e.x, y: e.y, r: 9, life: 14, col: '#bbb' }); arr.splice(i, 1); continue; }
        const tg = pickTarget(t, k.range, 'first', { x: e.x, y: e.y });
        if (tg) {
            e.ang = Math.atan2(tg.y - e.y, tg.x - e.x);
            if (e.cd <= 0) {
                for (let sh = 0; sh < k.shots; sh++)
                    mkDart(e.x, e.y, e.ang + (sh - (k.shots - 1) / 2) * 0.12 + rnd(-0.03, 0.03), t.s, { style: 'nail', dmg: k.dmg, pierce: k.pierce, spd: 15, range: k.range, pr: 3 });
                e.cd = k.rate * rm; e.flash = 4;
            }
        }
    }
    t.sentryC = (t.sentryC === undefined ? 30 : t.sentryC) - 1;
    if (roundInProgress && arr.length < k.max && t.sentryC <= 0) {
        for (let tries = 0; tries < 16; tries++) {
            const a = rnd(0, TAU), d = rnd(26, 56), x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d;
            if (x < 8 || y < 8 || x > W() - 8 || y > H() - 8) continue;
            if (distToTrack(x, y) < 22) continue;
            if (waterZones().some(w => Math.hypot(x - w.x, y - w.y) < w.r + 6)) continue;
            if (HAS_STUMP && Math.hypot(x - stump.x, y - stump.y) < stump.placeRadius) continue;
            arr.push({ x, y, life: k.life, cd: rnd(10, k.rate), ang: a, flash: 0 });
            addFx({ k: 'ring', x, y, r0: 4, r1: 18, life: 14, col: '#ffd54a', w: 2 });
            break;
        }
        t.sentryC = k.deploy;
    }
}
function updatePatches(t) {
    for (let i = t.patches.length - 1; i >= 0; i--) {
        const p = t.patches[i];
        p.life--; p.c--;
        if (p.life <= 0) { t.patches.splice(i, 1); continue; }
        if (p.c <= 0) {
            p.c = p.every;
            for (const b of bloons) if (b.hp > 0 && Math.hypot(b.x - p.x, b.y - p.y) <= p.r + b.radius * 0.4) hurt(b, p.d, p.burn ? { burn: p.burn } : null);
        }
    }
}
function updateSpikes(t) {
    const arr = t.spikes;
    for (let i = arr.length - 1; i >= 0; i--) {
        const sp = arr[i];
        sp.age++;
        if (!sp.perma && !t.s.perma && sp.age > sp.life) { arr.splice(i, 1); continue; }
        let dead = false;
        for (const b of bloons) {
            if (b.hp <= 0 || sp.hit.has(b)) continue;
            if (Math.abs(b.x - sp.x) > b.radius + 14 || Math.abs(b.y - sp.y) > b.radius + 14) continue;
            if (Math.hypot(b.x - sp.x, b.y - sp.y) > b.radius + 11) continue;
            if (sp.mine) {
                explode(sp.x, sp.y, sp.mine.aoe, sp.mine.dmg, sp);
                dead = true; break;
            }
            hurt(b, sp.dmg, sp);
            sp.hit.add(b);
            sp.pierce--;                       // one spike of the pile is used up
            if (sp.pierce <= 0) { dead = true; break; }
        }
        if (dead) {
            sp.dead = true; sp.pierce = 0;
            addFx({ k: 'puff', x: sp.x, y: sp.y, r: 6, life: 10, col: '#cfcfcf' });
            arr.splice(i, 1);
        }
    }
}

/* ---- per-kind step functions ---- */
function stepGun(t) {
    const s = t.s, rm = rateMul(t);
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - 0.18);
    if (t.spin > 0) t.spin = Math.max(0, t.spin - 0.03);
    if (s.per) tickPeriodic(t, t.x, t.y, rm);
    if (s.reactor) tickReactor(t, rm);
    if (s.crew) tickCrew(t, rm);
    if (s.storm) tickStorm(t, rm);
    if (s.sentry) tickSentries(t, rm);
    else if (t.sentries.length) t.sentries.length = 0;
    if (s.overclock) tickOverclock(t, rm);
    if (s.trap) tickTraps(t, rm);
    if (t.spikes.length) updateSpikes(t);
    if (t.cd > 0) t.cd--;
    const los = !t.xt.water;
    let tg = null, aim;
    if (t.xt.cursorAim && t.aim === 'cursor') {
        const inside = mouseX > 0 && mouseY > 0 && mouseX < W() && mouseY < H();
        if (inside) {
            aim = Math.atan2(mouseY - t.y, mouseX - t.x);
            // fire when any bloon is near the aimed line
            const L = s.range * 1.15, x2 = t.x + Math.cos(aim) * L, y2 = t.y + Math.sin(aim) * L;
            for (const b of bloons) if (b.hp > 0 && onScreen(b) && segDist(b.x, b.y, t.x, t.y, x2, y2) < b.radius + 14) { tg = b; break; }
            t.angle = lerpAngle(t.angle, aim, 0.4);
        }
    } else {
        tg = pickTarget(t, s.range, t.mode, { los });
        if (tg) { aim = Math.atan2(tg.y - t.y, tg.x - t.x); t.angle = lerpAngle(t.angle, aim, 0.45); }
    }
    if (tg && t.cd <= 0) {
        volley(t, t.x, t.y, tg, aim);
        t.cd = Math.max(1, s.rate * rm);
    } else if (!tg && t.xt.alwaysFire && roundInProgress && t.cd <= 0) {
        /* Dartling Gunner: keeps shooting along its current aim for the whole round */
        if (aim === undefined) aim = t.angle;
        volley(t, t.x, t.y, null, aim);
        t.cd = Math.max(1, s.rate * rm);
    }
}
function stepMortar(t) {
    const s = t.s, rm = rateMul(t);
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - 0.08);
    if (s.per) tickPeriodic(t, t.x, t.y, rm);
    if (t.patches.length) updatePatches(t);
    if (t.cd > 0) t.cd--;
    if (t.cd > 0) return;
    const list = pickMany(t, s.range, s.volley, { minR: s.minR, mode: t.mode === 'strong' ? 'strong' : (t.mode === 'last' || t.mode === 'close') ? t.mode : 'first' });
    if (t.mode === 'last') list.reverse();
    if (!list.length) return;
    t.angle = Math.atan2(list[0].y - t.y, list[0].x - t.x);
    const ox = t.x + Math.cos(t.angle) * 12, oy = t.y + Math.sin(t.angle) * 12;
    for (let i = 0; i < s.volley; i++) {
        launchShell(t, ox, oy, list[i % list.length], {
            dmg: s.dmg, aoe: s.aoe, ceramic: s.ceramic, blimp: s.blimp, stun: s.stun, burn: s.burn, patch: s.patch, maxHit: s.maxHit,
            jitter: s.jitter + (i > 0 && list.length === 1 ? 14 : 0), shellSpd: s.shellSpd, style: 'mortar'
        });
    }
    t.recoil = 1;
    t.cd = Math.max(8, s.rate * rm);
}
/* Ace darts fly in fixed directions (a spread around the plane, rotated by its heading).
   They never aim at a bloon and never home, whatever upgrades are owned. */
function aceVolley(t, ox, oy) {
    const s = t.s, n = Math.max(1, s.shots | 0);
    t.aceSpin = ((t.aceSpin || 0) + 0.7) % TAU;
    const base = t.th + Math.PI / 2 + t.aceSpin;
    for (let i = 0; i < n; i++) {
        const a = base + i * TAU / n + (Math.random() - 0.5) * s.spread;
        mkDart(ox, oy, a, s, { homing: 0, tgt: null, range: s.wr + 20 });
    }
    t.shots++; t.recoil = 1; t.spin = 1;
}
function stepAce(t) {
    const s = t.s, rm = rateMul(t), pl = t.plane;
    t.th += s.pspd / s.orb;
    pl.x = t.x + Math.cos(t.th) * s.orb; pl.y = t.y + Math.sin(t.th) * s.orb; pl.a = t.th + Math.PI / 2;
    t.spin += 0.5;
    if (s.per) tickPeriodic(t, pl.x, pl.y, rm);
    if (t.cd > 0) t.cd--;
    if (t.cd <= 0) {
        const tg = pickTarget(t, s.wr, t.mode, { x: pl.x, y: pl.y });
        if (tg) { aceVolley(t, pl.x, pl.y); t.cd = Math.max(2, s.rate * rm); }
    }
}
function stepSpike(t) {
    const s = t.s, rm = rateMul(t);
    if (t.cd > 0) t.cd--;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - 0.08);
    if (roundInProgress) {
        if (t.cd <= 0) {
            const p = pickTrackPoint(t, s.range, s.smart);
            if (p) {
                layPile(t, p, {
                    life: s.life, max: s.max, pierce: s.mine ? 1 : s.pierce, dmg: s.mine ? s.mine.dmg : s.dmg, mine: s.mine,
                    ceramic: s.ceramic, blimp: s.blimp, burn: s.burn, perma: s.perma
                });
                t.recoil = 1;
            }
            t.cd = Math.max(6, s.rate * rm);
        }
        if (s.dump) {
            t.dumpC = (t.dumpC === undefined ? Math.round(s.dump.every * 0.5) : t.dumpC) - 1 / rm;
            if (t.dumpC <= 0) {
                for (let i = 0; i < s.dump.n; i++) {
                    const p = pickTrackPoint(t, s.range, false);
                    if (p) layPile(t, p, { life: s.life, max: s.max + s.dump.n, pierce: s.mine ? 1 : s.pierce, dmg: s.mine ? s.mine.dmg : s.dmg, mine: s.mine, ceramic: s.ceramic, blimp: s.blimp, burn: s.burn, perma: s.perma });
                }
                t.dumpC = s.dump.every;
            }
        }
    }
    if (t.spikes.length) updateSpikes(t);
}
const STEPS = { gun: stepGun, mortar: stepMortar, ace: stepAce, spike: stepSpike };

/* ------------------------------------------------------------------ *
 * 6. UPGRADES (stat rebuild + purchase rules)
 * ------------------------------------------------------------------ */
function recompute(t) {
    const d = t.xt, s = JSON.parse(JSON.stringify(d.base));
    for (let p = 0; p < 3; p++) for (let i = 0; i < t.tiers[p]; i++) d.paths[p].up[i].f(s);
    if (d.kind === 'ace') s.range = s.orb + s.wr;
    t.s = s; t.range = s.range; t.damage = s.dmg; t.pierce = s.mine ? 1 : s.pierce; t.baseFireRate = s.rate;
    t.candR = null;
    if (d.after) d.after(t, s);
}
function upgradeState(t, p) {
    const tier = t.tiers[p];
    if (tier >= 5) return { st: 'max' };
    let up = t.xt.paths[p].up[tier]; const others = t.tiers.filter((v, i) => i !== p);
    if (EXT.price) { const pr = EXT.price(t, up.cost); if (pr !== up.cost) up = Object.assign({}, up, { cost: pr }); }
    if (tier === 0 && others.filter(v => v > 0).length >= 2) return { st: 'locked', why: 'Only two paths can be upgraded', up };
    if (tier >= 2 && others.some(v => v > 2)) return { st: 'locked', why: 'Only one path can go past tier 2', up };
    return { st: 'ok', up };
}
function buyUpgrade(t, p) {
    const us = upgradeState(t, p);
    if (us.st !== 'ok' || money < us.up.cost) return false;
    money -= us.up.cost; t.invested += us.up.cost;
    t.tiers[p]++; recompute(t);
    addFx({ k: 'ring', x: t.x, y: t.y, r0: 6, r1: 34, life: 20, col: '#7CFC00', w: 3 });
    addFx({ k: 'txt', x: t.x, y: t.y - 26, s: us.up.name, col: '#ffffff', life: 55 });
    updateMainUI();
    return true;
}

/* support auras, applied inside Tower.update (all towers, old and new) */
function applyExternalBuffs(t) {
    if (t.isFarm || t.isVillage) return;
    for (let i = 0; i < BUFFERS.length; i++) {
        const b = BUFFERS[i];
        if (b.t !== t && Math.hypot(t.x - b.t.x, t.y - b.t.y) <= b.r) { if (b.jungle) t.buffedJungle = true; else t.buffed = true; }
    }
    if (t.xOc && t.xOc.until > NOW) { if (t.xOc.f <= 0.65) t.buffedJungle = true; else t.buffed = true; }
}

/* round bookkeeping: Merchantman / Jungle's Bounty income, forest healing */
let lastRound = currentRound;
function onRoundEnd() {
    for (const f of EXT.round) f();
    let heal = 0;
    for (const t of towers) {
        if (!t.xt) continue;
        if (t.s.income) { money += t.s.income; addFx({ k: 'txt', x: t.x, y: t.y - 24, s: '+$' + t.s.income, col: '#7CFC00', life: 70 }); }
        heal += t.s.heal || 0;
    }
    if (heal > 0 && lives > 0 && lives < START_LIVES) {
        const before = lives; lives = Math.min(START_LIVES, lives + heal);
        const tw = towers.find(t => t.xt && t.s.heal);
        if (tw) addFx({ k: 'txt', x: tw.x, y: tw.y - 38, s: '+' + (lives - before) + ' ❤', col: '#ff6b81', life: 70 });
    }
}

/* ------------------------------------------------------------------ *
 * 7. MAIN TICK  (hooked after the game's own updateGame)
 * ------------------------------------------------------------------ */
function tick() {
    NOW++;
    for (let i = 0; i < EXT.pre.length; i++) EXT.pre[i]();
    if (currentRound !== lastRound) { lastRound = currentRound; onRoundEnd(); }
    for (const b of bloons) {
        if (b.xBurn) {
            const x = b.xBurn;
            if (b.hp <= 0) { b.xBurn = null; continue; }
            if (--x.t <= 0) { b.xBurn = null; continue; }
            if (--x.c <= 0) { x.c = x.n; hurt(b, x.d); addFx({ k: 'puff', x: b.x, y: b.y - 4, r: 5, life: 10, col: '#ff8a3d' }); }
        }
    }
    for (let i = 0; i < towers.length; i++) { const t = towers[i]; if (t.xt) STEPS[t.xt.kind](t); }
    for (let i = 0; i < XPS.length; i++) {
        const p = XPS[i];
        if (!p.dead) { const sf = EXT.step[p.kind]; if (sf) sf(p); else if (p.kind === 'shell') stepShell(p); else stepProj(p); }
        if (p.dead && p.onDie && !p.dd) { p.dd = 1; p.onDie(p); }
    }
    for (let i = XPS.length - 1; i >= 0; i--) if (XPS[i].dead) XPS.splice(i, 1);
    for (let i = FX.length - 1; i >= 0; i--) {
        const f = FX[i];
        if (--f.life <= 0) { FX.splice(i, 1); continue; }
        if (f.k === 'spark') { f.x += f.vx; f.y += f.vy; }
    }
    for (let i = 0; i < EXT.post.length; i++) EXT.post[i]();
    BUFFERS = [];
    for (const t of towers) if (t.xt && t.s.support) BUFFERS.push({ t, r: t.s.support.r, jungle: t.s.support.jungle });
}

/* ------------------------------------------------------------------ *
 * 8. ARTWORK  (all original Canvas drawings - no external assets)
 * ------------------------------------------------------------------ */
function circ(c, x, y, r, fill, stroke, lw) {
    c.beginPath(); c.arc(x, y, r, 0, TAU);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
}
function ell(c, x, y, rx, ry, fill, stroke, lw, rot) {
    c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
}
function rect(c, x, y, w, h, fill, stroke, lw, rad) {
    c.beginPath();
    if (rad) {
        const r = Math.min(rad, w / 2, h / 2);
        c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    } else c.rect(x, y, w, h);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
}
function poly(c, pts, fill, stroke, lw) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
}
/* same monkey face language as the original towers (ears, muzzle, eyes) */
function monkeyHead(c, x, y, r, skin, ear, muz) {
    skin = skin || '#8b5a2b'; ear = ear || '#6b4c3a'; muz = muz || '#d4a373';
    circ(c, x - r * 0.2, y - r * 0.85, r * 0.45, ear); circ(c, x - r * 0.2, y + r * 0.85, r * 0.45, ear);
    circ(c, x - r * 0.2, y - r * 0.85, r * 0.22, muz); circ(c, x - r * 0.2, y + r * 0.85, r * 0.22, muz);
    circ(c, x, y, r, skin, 'rgba(0,0,0,0.35)', 1);
    ell(c, x + r * 0.38, y, r * 0.55, r * 0.7, muz);
    circ(c, x + r * 0.45, y - r * 0.28, r * 0.13, '#111'); circ(c, x + r * 0.45, y + r * 0.28, r * 0.13, '#111');
}
function domPath(t) {                                // which upgrade path dominates (for visual flavour)
    if (!t) return -1;
    let m = 0, k = -1;
    for (let i = 0; i < 3; i++) if (t.tiers[i] > m) { m = t.tiers[i]; k = i; }
    return k;
}
const topTier = t => t ? Math.max(t.tiers[0], t.tiers[1], t.tiers[2]) : 0;

const SPR = {};

SPR.Dartling = function (c, t, a, T) {
    const tr = t ? t.tiers : [0, 0, 0], rec = t ? t.recoil : 0, spin = T * (0.12 + (t ? t.spin : 0) * 0.5);
    circ(c, 0, 0, 15.5, '#47572f', '#1b2412', 2); circ(c, 0, 0, 12, '#3a4826');
    c.save(); c.rotate(a);
    circ(c, -10.5, 0, 6, '#5a5f66', '#222', 1.2); circ(c, -10.5, 0, 2.5, '#2b2e33');
    if (tr[1] >= 2) { rect(c, 0, -12, 9, 4.5, '#7f8c8d', '#222', 1, 1); rect(c, 0, 7.5, 9, 4.5, '#7f8c8d', '#222', 1, 1); circ(c, 9.5, -9.7, 1.8, '#e74c3c'); circ(c, 9.5, 9.7, 1.8, '#e74c3c'); }
    monkeyHead(c, -3, 0, 8.5);
    c.beginPath(); c.arc(-3, 0, 9.4, Math.PI * 0.5, Math.PI * 1.5); c.closePath(); c.fillStyle = '#4b5d32'; c.fill(); c.strokeStyle = '#1b2412'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#e8c547'; c.fillRect(-7, -1, 3, 2);
    rect(c, 3, -5.5, 11, 11, '#50555c', '#1a1d20', 1.2, 2); rect(c, 5.5, -5.5, 2.4, 11, '#e67e22');
    const barrelCol = tr[0] >= 4 ? '#ff4fa3' : tr[0] >= 2 ? '#ff5252' : '#2b2b2b';
    for (let i = 0; i < 3; i++) {
        const oy = Math.sin(spin + i * 2.094) * 3.4;
        rect(c, 14 - rec * 2.5, oy - 1.5, 11, 3, barrelCol, '#111', 0.8);
    }
    circ(c, 14 - rec * 2.5, 0, 4.4, null, '#8a8f96', 1.6);
    if (rec > 0.5) { circ(c, 27, 0, 3.5, 'rgba(255,230,120,0.9)'); }
    if (tr[2] >= 3) { rect(c, -1, 6, 8, 3, '#d4a017', '#6b4f00', 0.8); }
    c.restore();
};

SPR.Mortar = function (c, t, a, T) {
    const rec = t ? t.recoil : 0, tr = t ? t.tiers : [0, 0, 0];
    circ(c, 0, 0, 16, '#8a7448', '#3f3420', 2);
    for (let i = 0; i < 9; i++) { const an = i * TAU / 9; ell(c, Math.cos(an) * 12.5, Math.sin(an) * 12.5, 4.2, 3, i % 2 ? '#b09a62' : '#a38c55', '#5b4a28', 0.8, an + Math.PI / 2); }
    circ(c, 0, 0, 9, '#4e4a3d');
    c.save(); c.rotate(a);
    rect(c, -2 - rec * 3, -4.8, 18, 9.6, tr[0] >= 4 ? '#5d3a3a' : '#3b4048', '#15171a', 1.4, 2);
    rect(c, 14 - rec * 3, -6.2, 4.2, 12.4, '#2a2d31', '#0e0f10', 1.2, 1);
    circ(c, 16 - rec * 3, 0, 3, '#000');
    if (tr[2] >= 1) { circ(c, 16 - rec * 3, 0, 2.4, '#ff7a1a'); }
    monkeyHead(c, -8, 7, 6.2); c.beginPath(); c.arc(-8, 7, 6.8, Math.PI * 0.55, Math.PI * 1.6); c.fillStyle = '#6a7a3a'; c.fill();
    if (rec > 0.4) circ(c, 22, 0, 4 + rec * 3, 'rgba(255,200,90,0.85)');
    c.restore();
};

SPR.Sub = function (c, t, a, T) {
    const tr = t ? t.tiers : [0, 0, 0];
    const w = 1 + Math.sin(T * 0.07) * 0.06;
    circ(c, 0, 0, 17 * w, 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.55)', 1.5);
    c.save(); c.rotate(a);
    ell(c, -1, 0, 18, 8.5, '#e0b422', '#6d5710', 1.6);
    ell(c, -1, 0, 18, 8.5, null, null); rect(c, -9, -8.4, 3, 16.8, '#c8581c'); rect(c, 7, -7.6, 3, 15.2, '#c8581c');
    poly(c, [[-18, 0], [-23, -6], [-21, 0], [-23, 6]], '#b8921a', '#6d5710', 1.2);
    circ(c, -22, 0, 3.4 + Math.sin(T * 0.8) * 0.8, 'rgba(255,255,255,0.5)');
    rect(c, -4, -5.2, 10, 10.4, '#8e9aa6', '#3a444d', 1.4, 4);
    monkeyHead(c, 0, 0, 4.3);
    rect(c, 5, -1, 6, 2, '#555'); rect(c, 10, -3, 2, 6, '#555');
    if (tr[2] >= 1) rect(c, 12, -2.6, 8, 1.6, '#c0392b'), rect(c, 12, 1, 8, 1.6, '#c0392b');
    if (tr[0] >= 4) circ(c, -9, 0, 3.6, '#6bff3d', '#2e8b00', 1);
    if (tr[0] >= 1) rect(c, -2, -9.5, 1.4, 5, '#bbb');
    circ(c, 17, 0, 1.8, '#333');
    c.restore();
};

SPR.Buccaneer = function (c, t, a, T) {
    const tr = t ? t.tiers : [0, 0, 0], carrier = tr[0] >= 4, bob = Math.sin(T * 0.06) * 0.6;
    circ(c, 0, 0, 19, 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.5)', 1.4);
    c.save(); c.rotate(a);
    poly(c, [[-17, -8], [8, -9.5], [20, 0], [8, 9.5], [-17, 8]], carrier ? '#6b7280' : '#8b5a2b', carrier ? '#2f343b' : '#4a2c10', 1.8);
    poly(c, [[-14, -6], [7, -7], [16, 0], [7, 7], [-14, 6]], carrier ? '#9aa3ad' : '#b07a42');
    c.strokeStyle = carrier ? 'rgba(0,0,0,0.25)' : 'rgba(80,45,15,0.5)'; c.lineWidth = 0.8;
    for (let x = -12; x < 12; x += 4) { c.beginPath(); c.moveTo(x, -6); c.lineTo(x, 6); c.stroke(); }
    if (carrier) { rect(c, -10, -2, 20, 4, '#f1c40f'); c.fillStyle = '#fff'; c.fillRect(-6, -0.6, 4, 1.2); }
    else {
        rect(c, 2 + bob * 0.3, -9, 3.4, 18, '#f5f1e3', '#8a7f5a', 1);
        rect(c, -8, -8, 3.2, 16, '#ece6d2', '#8a7f5a', 1);
        circ(c, 3.7, 0, 2, '#5b3a1a'); circ(c, -6.4, 0, 2, '#5b3a1a');
    }
    circ(c, 9, -7.4, 2.4, '#222', '#000', 0.8); circ(c, 9, 7.4, 2.4, '#222', '#000', 0.8);
    if (tr[1] >= 2) { circ(c, 14, -4, 1.8, '#222'); circ(c, 14, 4, 1.8, '#222'); }
    monkeyHead(c, -11, 0, 4.6); c.fillStyle = '#c0392b'; c.beginPath(); c.arc(-11, 0, 5, Math.PI * 0.5, Math.PI * 1.5); c.fill();
    rect(c, -17, -1, 1.4, 8, '#333'); poly(c, [[-17, -1], [-23, -3], [-23, 3]], '#111');
    if (tr[2] >= 3) { circ(c, 0, 0, 2.2, '#f1c40f', '#8a6d00', 0.8); }
    c.restore();
};

function drawPlane(c, x, y, ang, tr, T, scale) {
    const dp = Math.max(tr[0], tr[1], tr[2]) >= 3 ? (tr[0] >= tr[1] && tr[0] >= tr[2] ? 0 : (tr[1] >= tr[2] ? 1 : 2)) : -1;
    const body = dp === 0 ? '#c0392b' : dp === 1 ? '#5f7f3a' : dp === 2 ? '#3b4048' : '#e8e8ef';
    const wing = dp === 0 ? '#e74c3c' : dp === 1 ? '#7a9b4a' : dp === 2 ? '#555c66' : '#ff6b3d';
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(scale || 1, scale || 1);
    if (Math.max(tr[0], tr[1], tr[2]) >= 5) { c.fillStyle = 'rgba(255,220,120,0.25)'; c.beginPath(); c.ellipse(-8, 0, 20, 7, 0, 0, TAU); c.fill(); }
    if (dp === 1) poly(c, [[-4, -17], [3, -17], [5, -6], [5, 6], [3, 17], [-4, 17]], wing, '#2a3a15', 1.2);
    else if (dp === 0) poly(c, [[-8, -13], [4, -2], [4, 2], [-8, 13], [-4, 0]], wing, '#6b1d14', 1.2);
    else poly(c, [[-3, -15], [3, -15], [4, -3], [4, 3], [3, 15], [-3, 15]], wing, '#222', 1.2);
    poly(c, [[-14, -6], [-10, -6], [-8, -1], [-8, 1], [-10, 6], [-14, 6]], wing, '#222', 1);
    ell(c, 0, 0, 13, dp === 1 ? 5 : 4.2, body, '#222', 1.4);
    ell(c, 3, 0, 4, 2.8, '#9ad7ff', '#2c5d7c', 0.8);
    circ(c, 2.3, 0, 1.6, '#8b5a2b');
    if (dp === 2) { circ(c, -1, -9, 2.2, '#222'); circ(c, -1, 9, 2.2, '#222'); circ(c, -1, -14, 2, '#222'); circ(c, -1, 14, 2, '#222'); }
    if (dp === 0) { c.fillStyle = 'rgba(255,170,60,0.85)'; c.beginPath(); c.moveTo(-13, -2); c.lineTo(-13 - 5 - Math.random() * 3, 0); c.lineTo(-13, 2); c.fill(); }
    else { c.save(); c.translate(13, 0); c.rotate(T * 0.9); c.fillStyle = 'rgba(60,60,60,0.7)'; c.fillRect(-0.8, -6, 1.6, 12); c.restore(); }
    c.restore();
}
SPR.Ace = function (c, t, a, T) {
    circ(c, 0, 0, 16, '#4d535c', '#1d2125', 2);
    c.save(); c.setLineDash([4, 3]); circ(c, 0, 0, 12.5, null, 'rgba(255,255,255,0.7)', 1.2); c.restore();
    rect(c, -3, -9, 6, 18, '#3b4048'); c.fillStyle = '#f1c40f'; c.fillRect(-0.6, -8, 1.2, 4); c.fillRect(-0.6, -2, 1.2, 4); c.fillRect(-0.6, 4, 1.2, 4);
    if (!t) drawPlane(c, 0, 0, -0.5, [0, 0, 0], T, 0.8);
};

SPR.Druid = function (c, t, a, T) {
    const tr = t ? t.tiers : [0, 0, 0], dp = domPath(t);
    circ(c, 0, 0, 15.5, '#3f7d3a', '#1f4a1c', 1.8);
    const nl = tr[2] >= 4 || topTier(t) >= 5 ? 9 : 6;
    for (let i = 0; i < nl; i++) { const an = i * TAU / nl + (topTier(t) >= 4 ? T * 0.02 : 0); ell(c, Math.cos(an) * 12, Math.sin(an) * 12, 5, 2.4, i % 2 ? '#5cb85c' : '#7bd957', '#245c22', 0.7, an); }
    c.save(); c.rotate(a);
    const orb = dp === 1 ? '#6fc3ff' : dp === 2 ? '#ffd54a' : '#9bff6b';
    rect(c, 2, 5, 18, 2.4, '#6b4423', '#3a2410', 0.8);
    circ(c, 20, 6.2, 3.6 + Math.sin(T * 0.15) * 0.5, orb, '#fff', 1);
    circ(c, 20, 6.2, 7, null, orb.replace(')', ',0.4)').replace('#', '#'), 0);
    monkeyHead(c, -1, 0, 8.4, '#8b5a2b', '#6b4c3a', '#d4a373');
    c.beginPath(); c.arc(-1, 0, 9.4, Math.PI * 0.45, Math.PI * 1.55); c.closePath(); c.fillStyle = '#2f6e32'; c.fill(); c.strokeStyle = '#173d19'; c.lineWidth = 1; c.stroke();
    poly(c, [[-6, -7], [-2, -13], [0, -7]], '#7bd957', '#245c22', 0.8); poly(c, [[-6, 7], [-2, 13], [0, 7]], '#7bd957', '#245c22', 0.8);
    if (tr[1] >= 3) { c.strokeStyle = '#e6f6ff'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-8, -4); c.lineTo(-5, -1); c.lineTo(-8, 2); c.stroke(); }
    c.restore();
};

SPR.Spike = function (c, t, a, T) {
    const tr = t ? t.tiers : [0, 0, 0], rec = t ? t.recoil : 0;
    for (let i = 0; i < 3; i++) { const ph = ((T * 0.02 + i / 3) % 1); circ(c, 8 + ph * 5, -14 - ph * 12, 3 + ph * 4, 'rgba(210,210,210,' + (0.55 * (1 - ph)) + ')'); }
    rect(c, -18, -13, 28, 25, '#9aa0a6', '#33373b', 1.8, 3);
    rect(c, -18, -13, 28, 7, '#b45a3a', '#33373b', 1.2, 2);
    for (let i = 0; i < 4; i++) rect(c, -15 + i * 6.5, -12, 4, 5, i % 2 ? '#c96a46' : '#a04d2f');
    rect(c, 5, -20, 7, 10, '#6b6f74', '#33373b', 1.2);
    circ(c, -6, 4, 6, '#d7a22a', '#6b4f00', 1.2); circ(c, -6, 4, 2, '#6b4f00');
    for (let i = 0; i < 6; i++) { const an = i * TAU / 6 + T * 0.04 * (1 + rec); rect(c, -6 + Math.cos(an) * 5.4 - 1.1, 4 + Math.sin(an) * 5.4 - 1.1, 2.2, 2.2, '#d7a22a'); }
    rect(c, 8, 1, 14, 7, '#444', '#111', 1.2, 2);
    c.fillStyle = '#e8e8e8'; for (let i = 0; i < 3; i++) { const x = 11 + ((T * 0.25 + i * 4) % 10); poly(c, [[x, 2], [x + 3, 4.5], [x, 7]], '#dcdcdc'); }
    circ(c, 3, -3, 2.2, tr[0] >= 4 ? '#ff3b3b' : (rec > 0.4 ? '#7CFC00' : '#445'), '#111', 0.8);
    if (tr[1] >= 3) rect(c, -14, -21, 5, 8, '#6b6f74', '#33373b', 1);
};

SPR.Engineer = function (c, t, a, T) {
    const tr = t ? t.tiers : [0, 0, 0], rec = t ? t.recoil : 0;
    circ(c, 0, 0, 15.5, '#3d6e8f', '#183247', 1.8); circ(c, 0, 0, 12, '#2f5875');
    c.save(); c.rotate(a);
    rect(c, -13, 3, 11, 3, '#bfc4c9', '#555', 0.8); circ(c, -13, 4.5, 3, null, '#bfc4c9', 1.8);
    monkeyHead(c, -2, 0, 8.6);
    c.beginPath(); c.arc(-2, 0, 9.4, Math.PI * 0.5, Math.PI * 1.5); c.closePath(); c.fillStyle = '#f5b316'; c.fill(); c.strokeStyle = '#8a5d00'; c.lineWidth = 1; c.stroke();
    rect(c, 3.5, -5.2, 2.6, 10.4, '#222', null, 0, 1); rect(c, 4.2, -4.6, 1.3, 9.2, '#7fd1ff');
    rect(c, 4 - rec * 2, 4.5, 15, 5.2, '#8a9199', '#2a2d31', 1.2, 1.5); rect(c, 8 - rec * 2, 4.5, 3, 5.2, '#f5b316');
    rect(c, 18 - rec * 2, 5.4, 6, 3.4, '#4a4f55', '#111', 0.8);
    if (rec > 0.5) circ(c, 26, 7, 3, 'rgba(255,230,120,0.9)');
    if (tr[0] >= 1) rect(c, -9, -11, 5, 5, '#e67e22', '#7a3d00', 1, 1);
    if (tr[1] >= 2) { c.strokeStyle = '#ffe680'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-5, -10); c.lineTo(-3, -13); c.lineTo(-1, -10); c.stroke(); }
    c.restore();
};

/* hook the game's own sprite function so menus, previews and the upgrade
   panel all use the new artwork                                         */
const _drawEntity = drawEntity;
drawEntity = function (c, type, color, drawAngle, rotorAngle, extra) {
    const f = SPR[type];
    if (f) { c.save(); f(c, null, drawAngle || 0, 0); c.restore(); return; }
    return _drawEntity.apply(this, arguments);
};

/* ------------------------------------------------------------------ *
 * 9. WORLD DRAWING
 * ------------------------------------------------------------------ */
function drawPileSprite(sp, T) {
    ctx.save(); ctx.translate(sp.x, sp.y);
    if (sp.mine) {
        const big = sp.mine.aoe > 60;
        circ(ctx, 0, 0, big ? 10 : 7.5, '#3a3d42', '#111', 1.4); circ(ctx, 0, 0, big ? 5 : 3.5, '#555');
        circ(ctx, 0, 0, 2, (Math.floor(T / 14 + sp.x) % 2) ? '#ff3b3b' : '#6b1a1a');
    } else {
        ctx.rotate(sp.rot);
        const n = Math.max(1, Math.min(7, Math.ceil(7 * Math.max(0, sp.pierce) / (sp.p0 || 7)))), hot = !!sp.burn;
        for (let i = 0; i < n; i++) {
            const an = i * TAU / n;
            poly(ctx, [[Math.cos(an - 0.22) * 2, Math.sin(an - 0.22) * 2], [Math.cos(an) * 9, Math.sin(an) * 9], [Math.cos(an + 0.22) * 2, Math.sin(an + 0.22) * 2]], hot ? '#ff9a3d' : (sp.perma || sp.dmg > 3 ? '#c9d6e2' : '#cfcfcf'), '#2b2b2b', 0.8);
        }
        circ(ctx, 0, 0, 2.2, '#444');
    }
    ctx.restore();
}
function drawGroundLayer(t) {
    for (const p of t.patches) {
        const a = Math.min(1, p.life / 60) * 0.55;
        const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(255,200,60,' + a + ')'); g.addColorStop(0.6, 'rgba(255,100,20,' + a * 0.8 + ')'); g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        circ(ctx, p.x + Math.sin(NOW * 0.2 + p.x) * 6, p.y - 3 - (NOW % 12), 3, 'rgba(255,170,40,' + a + ')');
    }
    for (const sp of t.spikes) if (!sp.dead) drawPileSprite(sp, NOW);
    for (const e of t.sentries) {
        ctx.save(); ctx.translate(e.x, e.y);
        circ(ctx, 0, 0, 7, '#6d7782', '#252a30', 1.4); circ(ctx, 0, 0, 4, '#4a525b');
        ctx.rotate(e.ang); rect(ctx, 2, -1.8, 9 - (e.flash > 0 ? 2 : 0), 3.6, '#2d3238', '#000', 0.8);
        if (e.flash > 0) circ(ctx, 13, 0, 3, 'rgba(255,230,120,0.9)');
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(e.x - 7, e.y + 9, 14, 2);
        ctx.fillStyle = '#7CFC00'; ctx.fillRect(e.x - 7, e.y + 9, 14 * Math.max(0, e.life / t.s.sentry.life), 2);
    }
}
function drawXT(t) {
    drawGroundLayer(t);
    if (t.xt.ground) t.xt.ground(t);
    ctx.save(); ctx.translate(t.x, t.y);
    if (t.buffed || t.buffedJungle) {
        ctx.beginPath(); ctx.arc(0, 0, t.radius + 3, 0, TAU);
        ctx.strokeStyle = t.buffedJungle ? 'limegreen' : 'gold'; ctx.lineWidth = t.buffedJungle ? 4 : 3; ctx.stroke();
    }
    if (t.bfVis && !t.buffed && !t.buffedJungle) { ctx.beginPath(); ctx.arc(0, 0, t.radius + 3, 0, TAU); ctx.strokeStyle = t.bfVis; ctx.lineWidth = 3; ctx.stroke(); }
    if (t.xOc && t.xOc.until > NOW) { ctx.beginPath(); ctx.arc(0, 0, t.radius + 6 + Math.sin(NOW * 0.3), 0, TAU); ctx.strokeStyle = 'rgba(255,224,102,0.8)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    SPR[t.type](ctx, t, t.angle || 0, NOW);
    if (topTier(t) >= 5) { ctx.beginPath(); ctx.arc(0, 0, t.radius + 5, 0, TAU); ctx.strokeStyle = 'rgba(255,215,0,' + (0.5 + 0.3 * Math.sin(NOW * 0.1)) + ')'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.restore();
    if (t.tiers[0] + t.tiers[1] + t.tiers[2] > 0) {
        ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        const lbl = t.tiers.join('-'); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(lbl, t.x, t.y + t.radius + 11);
        ctx.fillStyle = '#fff'; ctx.fillText(lbl, t.x, t.y + t.radius + 11);
    }
    if (activeTower === t) {
        const rg = t.xt.ring ? t.xt.ring(t) : { x: t.x, y: t.y, r: t.range };
        if (rg.r > 2000) { ctx.beginPath(); ctx.arc(t.x, t.y, t.radius + 8, 0, TAU); ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.stroke(); }
        if (t.xt.kind === 'mortar') { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(t.x, t.y, t.s.minR, 0, TAU); ctx.strokeStyle = 'rgba(255,120,120,0.9)'; ctx.stroke(); ctx.setLineDash([]); }
        if (t.xt.kind === 'ace') { ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(t.x, t.y, t.s.orb, 0, TAU); ctx.strokeStyle = 'rgba(140,200,255,0.9)'; ctx.stroke(); ctx.setLineDash([]); }
        if (t.s.support) { ctx.beginPath(); ctx.arc(t.x, t.y, t.s.support.r, 0, TAU); ctx.strokeStyle = 'rgba(255,215,0,0.6)'; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]); }
    }
}

/* ---- water ponds for maps that have none ---- */
function drawPonds() {
    for (const p of OWN_PONDS) {
        const g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r);
        g.addColorStop(0, '#7fd3ff'); g.addColorStop(1, '#2f9be0');
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = '#a58a5c'; ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        for (let i = 0; i < 2; i++) { const ph = ((NOW * 0.01 + i * 0.5) % 1); ctx.beginPath(); ctx.arc(p.x + p.r * 0.15, p.y + p.r * 0.1, p.r * (0.25 + ph * 0.6), 0, TAU); ctx.globalAlpha = 1 - ph; ctx.stroke(); ctx.globalAlpha = 1; }
        circ(ctx, p.x - p.r * 0.45, p.y + p.r * 0.35, 5, '#3f9f4a', '#256b2e', 1); circ(ctx, p.x + p.r * 0.4, p.y - p.r * 0.4, 4, '#3f9f4a', '#256b2e', 1);
    }
}

/* ---- airborne layer drawn after the game's own frame ---- */
function drawXP(p) {
    const s = p.style;
    if (EXT.draw[p.kind]) { EXT.draw[p.kind](p); return; }
    if (p.kind === 'shell') {
        const z = p.z || 0;
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 5, 2.6, 0, 0, TAU); ctx.fill();
        if (s === 'toss') { ctx.save(); ctx.translate(p.x, p.y - z); ctx.rotate(p.t * 0.5); for (let i = 0; i < 4; i++) { ctx.rotate(TAU / 4); poly(ctx, [[0, 0], [5, -1.5], [5, 1.5]], '#d0d0d0', '#222', 0.6); } ctx.restore(); return; }
        if (s === 'foam') { circ(ctx, p.x, p.y - z, 4.5, '#e8fbff', '#7ad0e8', 1.2); return; }
        const big = s === 'bigone' ? 10 : (s === 'bigbomb' ? 8 : s === 'nuke' ? 11 : 5);
        ctx.save(); ctx.translate(p.x, p.y - z);
        if (s === 'pine') { ell(ctx, 0, 0, 4.5, 5.5, '#e8c13a', '#7a5a00', 1); poly(ctx, [[-2, -5], [0, -9], [2, -5]], '#3f9f4a', '#256b2e', 0.8); }
        else if (s === 'nuke') { circ(ctx, 0, 0, big, '#2b2b2b', '#ff3b3b', 2); circ(ctx, 0, 0, big * 0.45, '#ffe066'); }
        else { circ(ctx, 0, 0, big, s === 'bigone' ? '#7b1f1f' : '#222', '#000', 1.2); circ(ctx, -big * 0.3, -big * 0.3, big * 0.28, 'rgba(255,255,255,0.35)'); if (s === 'bomb' || s === 'bigbomb') { c2(ctx, big); } }
        ctx.restore();
        return;
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
    if (EXT.style[s]) { EXT.style[s](ctx, p); ctx.restore(); return; }
    switch (s) {
        case 'laser': ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,60,60,0.45)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(8, 0); ctx.stroke(); ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); break;
        case 'plasma': { const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 10); g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#ff6bd6'); g.addColorStop(1, 'rgba(180,0,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); break; }
        case 'thorn': poly(ctx, [[-7, -1.5], [2, -1.5], [9, 0], [2, 1.5], [-7, 1.5]], '#5a3a1a', '#2a1808', 0.6); poly(ctx, [[2, -3], [10, 0], [2, 3]], '#8bdc52', '#2f6e1c', 0.8); break;
        case 'nail': rect(ctx, -6, -0.9, 10, 1.8, '#c8ccd0', '#555', 0.5); rect(ctx, -7.5, -2.4, 2, 4.8, '#8a9199'); break;
        case 'cannon': circ(ctx, 0, 0, 4.5, '#1c1c1c', '#000', 1); circ(ctx, -1.5, -1.5, 1.4, 'rgba(255,255,255,0.5)'); circ(ctx, -7, 0, 2.5, 'rgba(180,180,180,0.5)'); break;
        case 'grape': circ(ctx, 0, 0, 3.4, '#8e44ad', '#4a1b66', 0.8); break;
        case 'rocket': case 'missile': { const L = s === 'rocket' ? 5 : 8; poly(ctx, [[-L, -2.2], [L * 0.4, -2.2], [L, 0], [L * 0.4, 2.2], [-L, 2.2]], '#e8e8e8', '#444', 0.8); poly(ctx, [[-L, -2.2], [-L - 3, -4], [-L + 1, 0], [-L - 3, 4], [-L, 2.2]], '#e74c3c'); ctx.fillStyle = 'rgba(255,170,40,0.9)'; ctx.beginPath(); ctx.moveTo(-L - 1, -1.4); ctx.lineTo(-L - 8 - Math.random() * 4, 0); ctx.lineTo(-L - 1, 1.4); ctx.fill(); break; }
        case 'bigmissile': poly(ctx, [[-13, -4], [6, -4], [15, 0], [6, 4], [-13, 4]], '#cfd3d8', '#333', 1); poly(ctx, [[-13, -4], [-19, -8], [-9, 0], [-19, 8], [-13, 4]], '#c0392b'); rect(ctx, -2, -4, 3, 8, '#f1c40f'); ctx.fillStyle = 'rgba(255,150,30,0.95)'; ctx.beginPath(); ctx.moveTo(-13, -2.6); ctx.lineTo(-26 - Math.random() * 8, 0); ctx.lineTo(-13, 2.6); ctx.fill(); break;
        default: rect(ctx, -6, -0.8, 9, 1.6, '#8b5a2b'); poly(ctx, [[2, -2.6], [9, 0], [2, 2.6]], '#eee', '#555', 0.6); poly(ctx, [[-6, 0], [-9, -2.4], [-4, 0], [-9, 2.4]], '#e74c3c');
    }
    ctx.restore();
}
function c2(c, r) { c.strokeStyle = '#ffd54a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(r * 0.6, -r * 0.6); c.lineTo(r, -r); c.stroke(); }
function drawFx(f) {
    const u = f.life / f.max;
    if (EXT.fx[f.k]) { EXT.fx[f.k](f, u); return; }
    switch (f.k) {
        case 'ring': ctx.beginPath(); ctx.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * (1 - u), 0, TAU); ctx.globalAlpha = Math.max(0, u); ctx.strokeStyle = f.col; ctx.lineWidth = f.w; ctx.stroke(); ctx.globalAlpha = 1; break;
        case 'flash': ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * (1 - u)), 0, TAU); ctx.globalAlpha = u * 0.8; ctx.fillStyle = f.col; ctx.fill(); ctx.globalAlpha = 1; break;
        case 'spark': ctx.globalAlpha = u; circ(ctx, f.x, f.y, 2, f.col); ctx.globalAlpha = 1; break;
        case 'puff': ctx.globalAlpha = u * 0.7; circ(ctx, f.x, f.y - (1 - u) * 8, f.r * (1.4 - u * 0.4), f.col); ctx.globalAlpha = 1; break;
        case 'beam': ctx.globalAlpha = u; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,60,110,0.5)'; ctx.lineWidth = f.w * 1.8; ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = f.w * 0.5; ctx.stroke(); ctx.globalAlpha = 1; break;
        case 'bolt': {
            ctx.globalAlpha = Math.min(1, u * 1.5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            const pts = f.pts;
            for (let pass = 0; pass < 2; pass++) {
                ctx.strokeStyle = pass ? '#fff' : f.col; ctx.lineWidth = pass ? f.w * 0.4 : f.w; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i], n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 16));
                    for (let k = 1; k <= n; k++) { const jx = k === n ? 0 : Math.sin(f.life * 3 + k * 5 + i) * 5; ctx.lineTo(a.x + (b.x - a.x) * k / n + jx, a.y + (b.y - a.y) * k / n + jx * 0.6); }
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1; break;
        }
        case 'txt': ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, u * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(f.s, f.x, f.y - (1 - u) * 22); ctx.fillStyle = f.col; ctx.fillText(f.s, f.x, f.y - (1 - u) * 22); ctx.globalAlpha = 1; break;
    }
}
function drawOverlay() {
    ctx.save();
    for (const b of bloons) if (b.xBurn && b.hp > 0) { ctx.globalAlpha = 0.9; ell(ctx, b.x, b.y - b.radius, 4, 6 + Math.sin(NOW * 0.5 + b.x) * 1.5, '#ff8a1a'); ell(ctx, b.x, b.y - b.radius + 1, 2, 3.5, '#ffe066'); ctx.globalAlpha = 1; }
    for (const t of towers) if (t.xt && t.xt.kind === 'ace') {
        const pl = t.plane;
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(pl.x + 6, pl.y + 10, 12, 4, pl.a, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        drawPlane(ctx, pl.x, pl.y, pl.a, t.tiers, t.spin, 1 + (topTier(t) >= 5 ? 0.25 : 0));
    }
    for (const fn of EXT.overlay) fn();
    for (const p of XPS) drawXP(p);
    for (const f of FX) drawFx(f);
    const sel = selectedBuildType && DEFS[selectedBuildType];
    if (sel && sel.water) {
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.35 * Math.sin(NOW * 0.12)) + ')'; ctx.setLineDash([8, 6]);
        for (const w of waterZones()) { ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText('🌊 Naval tower: place it on water', W() / 2, 22); ctx.fillStyle = '#fff'; ctx.fillText('🌊 Naval tower: place it on water', W() / 2, 22);
    }
    ctx.restore();
}

/* ------------------------------------------------------------------ *
 * 10. TOWER MENU  (Primary / Military / Magic / Support)
 * ------------------------------------------------------------------ */
const MENU = [
    ['Primary', ['Dart', 'Boomerang', 'Bomb', 'Tack', 'Ice', 'Glue']],
    ['Military', ['Sniper', 'Sub', 'Buccaneer', 'Ace', 'Heli', 'Mortar', 'Dartling']],
    ['Magic', ['Wizard', 'Super', 'Ninja', 'Alchemist', 'Druid']],
    ['Support', ['Farm', 'Spike', 'Village', 'Engineer']]
];
const NAMES = {
    Dart: 'Dart Monkey', Boomerang: 'Boomerang Monkey', Bomb: 'Bomb Shooter', Tack: 'Tack Shooter', Ice: 'Ice Monkey', Glue: 'Glue Gunner',
    Sniper: 'Sniper Monkey', Sub: 'Monkey Sub', Buccaneer: 'Monkey Buccaneer', Ace: 'Monkey Ace', Heli: 'Heli Pilot', Mortar: 'Mortar Monkey', Dartling: 'Dartling Gunner',
    Wizard: 'Wizard Monkey', Super: 'Super Monkey', Ninja: 'Ninja Monkey', Alchemist: 'Alchemist', Druid: 'Druid',
    Farm: 'Banana Farm', Spike: 'Spike Factory', Village: 'Monkey Village', Engineer: 'Engineer Monkey'
};

const STYLE = `
.tower-btns-container{grid-template-columns:repeat(2,minmax(0,1fr))}
.tower-btn{min-width:0}
.tower-btn .xt-label{display:flex;flex-direction:column;flex:1 1 0;text-align:left;direction:ltr;line-height:1.2;min-width:0;overflow:hidden}
.tower-btn .xt-label b{display:block;font-size:11px;white-space:normal;word-break:break-word}
.tower-btn .xt-label i{font-style:normal;font-weight:600;color:#2e7d32;font-size:11.5px}
.tower-btn.xt-poor{opacity:.5;filter:grayscale(.55)}
.tower-btn.xt-new{box-shadow:inset 0 0 0 1px #ffd54a}
#towerMenu h3{position:sticky;top:-15px;background:#fff;z-index:2;margin:0 0 6px;padding:4px 0}
#leftPanels{width:250px}
#upgradePanel button[onclick^="sellTower"]{position:sticky;bottom:-15px;z-index:3;margin-top:10px !important;box-shadow:0 -8px 8px 2px #fff}
#xt-panel{direction:ltr;text-align:left;margin-top:6px}
#xt-panel .xt-blurb{font-size:11.5px;color:#555;margin:2px 0 6px;text-align:center}
#xt-panel .xt-stats{font-size:12px;background:#f8f9fa;border-radius:5px;padding:4px 6px;margin-bottom:6px;text-align:center}
#xt-panel .xt-row{display:flex;gap:6px;margin-bottom:6px}
#xt-panel .xt-mini{flex:1;padding:7px 4px;font-size:12px;font-weight:700;border:2px solid #007bff;background:#e7f1ff;color:#0b4fa8;border-radius:6px;cursor:pointer;min-height:34px}
#xt-panel .xt-path{border:1px solid #d5d9de;border-radius:7px;padding:5px 6px 6px;margin-bottom:6px;background:#fcfcfd}
#xt-panel .xt-ptitle{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800;color:#333;margin-bottom:3px}
#xt-panel .xt-pips{letter-spacing:1px;font-size:11px}
#xt-panel .xt-pips .on{color:#e8a200}#xt-panel .xt-pips .off{color:#c3c7cc}
#xt-panel .xt-owned{font-size:10.5px;color:#6b7280;margin-bottom:3px}
#xt-panel button.xt-up{width:100%;text-align:left;padding:6px 8px;border:none;border-radius:6px;background:#28a745;color:#fff;cursor:pointer;font-weight:700;font-size:12px;min-height:40px}
#xt-panel button.xt-up small{display:block;font-weight:500;font-size:10.5px;opacity:.95;margin-top:1px}
#xt-panel button.xt-up:hover:not(:disabled){background:#218838}
#xt-panel button.xt-up:disabled{background:#cfd4d9;color:#6b7280;cursor:not-allowed}
#xt-panel .xt-max{font-size:12px;font-weight:800;color:#b8860b;text-align:center;padding:6px;background:#fff7d6;border-radius:6px}
#xt-panel .xt-close{display:none;float:right;border:none;background:#eee;border-radius:50%;width:28px;height:28px;font-size:14px;cursor:pointer}
@media (max-width:1180px){
 html,body{overflow-x:hidden}
 #ui{font-size:15px;padding:10px;max-width:calc(100vw - 70px);box-sizing:border-box}
 #settings-btn{transform:scale(.75);transform-origin:top right}
 #gameContainer{flex-wrap:wrap;gap:8px}
 #gameCanvas{order:1;width:100%;max-width:700px;height:auto;touch-action:manipulation}
 #sidePanels{order:2;width:100%;max-width:700px}
 #towerMenu{max-height:40vh}
 #leftPanels{position:fixed;left:0;right:0;bottom:0;width:auto;max-height:52vh;z-index:2000;overflow:auto;box-shadow:0 -4px 16px rgba(0,0,0,.35);background:#fff}
 #leftPanels .panel-box{max-height:none;border-radius:10px 10px 0 0}
 #xt-panel .xt-close{display:inline-block}
}`;

function buildMenu() {
    const old = document.getElementById('xt-style'); if (old) old.remove();
    const st = document.createElement('style'); st.id = 'xt-style'; st.textContent = STYLE; document.head.appendChild(st);
    const host = document.getElementById('towerMenu');
    if (!host) return;
    host.innerHTML = '';
    for (const [cat, list] of MENU) {
        const g = document.createElement('div'); g.className = 'tower-group';
        const h = document.createElement('h3'); h.textContent = cat; g.appendChild(h);
        const grid = document.createElement('div'); grid.className = 'tower-btns-container';
        for (const type of list) {
            if (!TOWER_TYPES[type]) continue;
            const b = document.createElement('button');
            b.className = 'tower-btn' + (DEFS[type] && !DEFS[type].orig ? ' xt-new' : ''); b.id = 'btn-' + type;
            b.title = (DEFS[type] ? DEFS[type].blurb : NAMES[type]);
            b.onclick = () => selectTower(type);
            b.innerHTML = '<canvas id="icon-' + type + '" class="icon-canvas" width="34" height="34"></canvas>' +
                '<span class="xt-label"><b>' + NAMES[type] + (DEFS[type] && DEFS[type].water ? ' 🌊' : '') + '</b><i>💵 ' + TOWER_TYPES[type].cost + '</i></span>';
            grid.appendChild(b);
        }
        g.appendChild(grid); host.appendChild(g);
    }
    if (typeof generateMenuIcons === 'function') generateMenuIcons();
}
let lastMoneySeen = -1;
function refreshMenu() {
    if (money === lastMoneySeen) return;
    lastMoneySeen = money;
    for (const [, list] of MENU) for (const type of list) {
        const b = document.getElementById('btn-' + type);
        if (b && TOWER_TYPES[type]) b.classList.toggle('xt-poor', money < TOWER_TYPES[type].cost);
    }
}

/* ------------------------------------------------------------------ *
 * 11. UPGRADE PANEL (3 paths x 5 tiers)
 * ------------------------------------------------------------------ */
let panelSig = '', uidCounter = 0;
const MODES = ['first', 'last', 'close', 'strong'];
const MODE_LABEL = { first: 'First', last: 'Last', close: 'Close', strong: 'Strong' };

function ensurePanel() {
    let h = document.getElementById('xt-panel');
    if (!h) {
        h = document.createElement('div'); h.id = 'xt-panel';
        const anchor = document.getElementById('upg-btn');
        anchor.parentNode.insertBefore(h, anchor.nextSibling);
    }
    return h;
}
function renderPanel(t) {
    const host = ensurePanel();
    host.style.display = 'block';
    const d = t.xt;
    document.getElementById('upg-btn').style.display = 'none';
    document.getElementById('upg-title').innerText = d.name;
    const cv = document.getElementById('upg-tower-icon'), c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    c.save(); c.translate(40, 40); c.scale(1.9, 1.9); SPR[t.type](c, t, -0.5, NOW);
    if (t.type === 'Ace') drawPlane(c, 0, 0, -0.5, t.tiers, NOW, 0.85);
    c.restore();

    const flags = [0, 1, 2].map(p => { const us = upgradeState(t, p); return us.st === 'ok' && money >= us.up.cost ? 1 : 0; }).join('');
    const sig = [t.uid, t.tiers.join(''), t.mode, t.aim, flags, t.invested, d.statLine ? Math.floor(NOW / 20) : 0, d.statLine ? d.statLine(t).length : 0].join('|');
    if (sig === panelSig && host.firstChild) return;
    panelSig = sig;
    host.innerHTML = '';
    const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
    const s = t.s;
    const close = el('button', 'xt-close', '✕'); close.onclick = () => { activeTower = null; updateMainUI(); }; host.appendChild(close);
    host.appendChild(el('div', 'xt-blurb', d.blurb));
    const rate = s.rate ? (60 / (s.rate * rateMul(t))).toFixed(1) + '/s' : '-';
    const extraLine = d.statLine ? d.statLine(t) : null;
    const extra = d.kind === 'mortar' ? ' · Blast ' + Math.round(s.aoe) : d.kind === 'spike' ? ' · Piles ' + s.max : d.kind === 'ace' ? ' · Orbit ' + s.orb : '';
    host.appendChild(el('div', 'xt-stats', extraLine !== null ? extraLine : 'Range <b>' + Math.round(s.range) + '</b> · Rate <b>' + rate + '</b>' + extra +
        ((s.income) ? '<br>💰 +$' + s.income + '/round' : '') + ((s.heal) ? ' · ❤ +' + s.heal + '/round' : '')));
    const row = el('div', 'xt-row');
    if (d.kind !== 'spike' && !d.noTarget) {
        const tb = el('button', 'xt-mini', '🎯 Target: ' + MODE_LABEL[t.mode]);
        tb.onclick = () => { t.mode = MODES[(MODES.indexOf(t.mode) + 1) % 4]; panelSig = ''; updateMainUI(); };
        row.appendChild(tb);
    }
    if (d.cursorAim) {
        const ab = el('button', 'xt-mini', '🖱 Aim: ' + (t.aim === 'cursor' ? 'Cursor' : 'Auto'));
        ab.onclick = () => { t.aim = t.aim === 'cursor' ? 'auto' : 'cursor'; panelSig = ''; updateMainUI(); };
        row.appendChild(ab);
    }
    if (row.children.length) host.appendChild(row);
    for (let p = 0; p < 3; p++) {
        const path = d.paths[p], tier = t.tiers[p], us = upgradeState(t, p);
        const box = el('div', 'xt-path');
        let pips = ''; for (let i = 0; i < 5; i++) pips += '<span class="' + (i < tier ? 'on' : 'off') + '">●</span>';
        box.appendChild(el('div', 'xt-ptitle', '<span>' + (p + 1) + '. ' + path.name + '</span><span class="xt-pips">' + pips + '</span>'));
        if (tier > 0) box.appendChild(el('div', 'xt-owned', '✔ ' + path.up[tier - 1].name));
        if (us.st === 'max') box.appendChild(el('div', 'xt-max', '★ MAX TIER ★'));
        else {
            const b = el('button', 'xt-up', us.up.name + ' — $' + us.up.cost + '<small>' + (us.st === 'locked' ? '🔒 ' + us.why : us.up.desc) + '</small>');
            b.disabled = us.st === 'locked' || money < us.up.cost;
            b.title = us.up.desc;
            b.onclick = () => buyUpgrade(t, p);
            box.appendChild(b);
        }
        host.appendChild(box);
    }
}
function afterUI() {
    refreshMenu();
    if (activeTower && activeTower.xt) renderPanel(activeTower);
    else { const h = document.getElementById('xt-panel'); if (h) { h.style.display = 'none'; panelSig = ''; } }
}

/* ------------------------------------------------------------------ *
 * 12. HOOKS INTO THE EXISTING GAME
 * ------------------------------------------------------------------ */
/* 12a. Tower subclass: new towers get their own state, old ones get support buffs */
const BaseTower = Tower;
Tower = class XTower extends BaseTower {
    constructor(type, x, y) {
        super(type, x, y);
        const d = DEFS[type];
        if (!d) return;
        this.xt = d; this.uid = ++uidCounter; this.tiers = [0, 0, 0]; this.mode = 'first'; this.aim = 'auto';
        this.cd = 0; this.shots = 0; this.pcd = {}; this.spikes = []; this.sentries = []; this.patches = [];
        this.angle = -Math.PI / 2; this.recoil = 0; this.spin = 0; this.th = Math.random() * TAU; this.plane = { x, y, a: 0 };
        this.invested = d.cost;
        recompute(this);
        if (d.init) d.init(this);
    }
    update() {
        applyExternalBuffs(this);
        if (this.xt) return;                        // new towers are stepped in tick()
        super.update();
    }
    draw() { if (this.xt) drawXT(this); else super.draw(); }
};

/* 12b. run the new towers right after the game's own update */
const _updateGame = updateGame;
let uiSuppress = 0, uiDirty = false;
updateGame = function () {
    _updateGame.apply(this, arguments);
    if (typeof gameOver !== 'undefined' && gameOver) return;
    const n = SCALED_DT ? Math.max(1, Math.round(gameSpeedMultiplier)) : 1;
    uiSuppress++;
    try { for (let i = 0; i < n; i++) tick(); } finally { uiSuppress--; }
    if (uiDirty) { uiDirty = false; updateMainUI(); }
};
/* batch the many updateMainUI() calls that pops trigger */
const _updateMainUI = updateMainUI;
updateMainUI = function () {
    if (uiSuppress > 0) { uiDirty = true; return; }
    _updateMainUI.apply(this, arguments);
    afterUI();
};

/* 12c. placement: naval towers need water, land towers must stay off ponds */
const _isValidPlacement = isValidPlacement;
isValidPlacement = function (x, y, radius) {
    const d = DEFS[selectedBuildType];
    if (d && d.water) return waterPlacementOK(x, y, radius);
    if (!_isValidPlacement.apply(this, arguments)) return false;
    for (const p of OWN_PONDS) if (Math.hypot(x - p.x, y - p.y) < radius + p.r) return false;
    return true;
};

/* 12d. ponds are drawn with the map; airborne effects after each frame */
if (typeof drawPath === 'function') {
    const _drawPath = drawPath;
    drawPath = function () { _drawPath.apply(this, arguments); drawPonds(); };
}
const _raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = function (cb) {
    return _raf(function (ts) { cb(ts); try { drawOverlay(); } catch (e) { console.error('[BTDX overlay]', e); } });
};

/* 12e. mobile / small screens: scale pointer coordinates when the canvas is CSS-resized */
(function () {
    const host = canvas.parentElement;
    /* CSS-scale factor of the canvas content box (the 4px border is NOT scaling) */
    const scaleOf = () => ({ sx: canvas.width / (canvas.clientWidth || canvas.width), sy: canvas.height / (canvas.clientHeight || canvas.height) });
    const redirect = e => {
        if (e._xt) return;
        const { sx, sy } = scaleOf();
        if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;      // unscaled: leave the game's own maths alone
        const r = canvas.getBoundingClientRect();
        e.stopImmediatePropagation(); e.preventDefault();
        const gx = (e.clientX - r.left - canvas.clientLeft) * sx, gy = (e.clientY - r.top - canvas.clientTop) * sy;
        const ne = new MouseEvent(e.type, { bubbles: true, cancelable: true, clientX: r.left + gx, clientY: r.top + gy, view: window });
        ne._xt = true; canvas.dispatchEvent(ne);
    };
    host.addEventListener('click', e => { if (e.target === canvas) redirect(e); }, true);
    host.addEventListener('mousemove', e => { if (e.target === canvas) redirect(e); }, true);
    const touchPos = e => {
        const t = e.touches[0]; if (!t) return;
        const r = canvas.getBoundingClientRect(), { sx, sy } = scaleOf();
        mouseX = (t.clientX - r.left - canvas.clientLeft) * sx; mouseY = (t.clientY - r.top - canvas.clientTop) * sy;
    };
    canvas.addEventListener('touchstart', touchPos, { passive: true });
    canvas.addEventListener('touchmove', touchPos, { passive: true });
})();

/* ------------------------------------------------------------------ *
 * 13. START UP
 * ------------------------------------------------------------------ */
buildMenu();
updateMainUI();
window.BTDX = { DEFS, SPR, recompute, buyUpgrade, upgradeState, tick, XPS, FX, waterZones, version: '2.0' };
/* helpers shared with btd_originals.js */
window.BTDX.api = {
    EXT, STEPS, MAP, MODES, MODE_LABEL, SCALED_DT, HAS_STUMP, PATH_PTS, START_LIVES: () => START_LIVES, NOW: () => NOW,
    W, H, rnd, clamp, TAU, prog, strength, segDist, distToTrack, blockedLOS, onScreen, lerpAngle, predict, waterZones,
    addFx, slowBloon, burnBloon, applyStatus, hurt, explode, fxBoom, pickTarget, pickMany, nearestBloon, rateMul,
    mkDart, stepProj, launchShell, launchMissile, chainLightning, pickTrackPoint, layPile, updateSpikes, updatePatches,
    recompute, buyUpgrade, upgradeState, mk, per, R, U, COMMON, circ, ell, rect, poly, monkeyHead, topTier, domPath,
    drawPlane, rebuildMenu: buildMenu, refreshAll: () => { panelSig = ''; updateMainUI(); }, XPS, FX, PAL
};
console.log('[BTDX] Expansion loaded: +' + Object.keys(DEFS).length + ' towers (map: ' + MAP + ')');
})();
