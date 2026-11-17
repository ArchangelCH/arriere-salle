// Le pointeur du MJ sur la TV : un point doré qui suit sa souris sur le plan ou la carte à l'écran, avec une courte
// traînée, et une onde quand il clique. Un calque à part, en éléments que le compositeur ne fait que déplacer et fondre :
// le plan ne se repeint jamais pour lui, et rien ne tourne quand il n'y a pas de pointeur. Les positions arrivent en
// coordonnées du plan (cases) ou de la carte : chaque écran les place avec son propre cadrage, y compris pendant que la
// caméra glisse. Un point hors du cadre de l'écran n'y apparaît pas (ni flèche au bord : le MJ promène sa souris sur une
// vue plus large que celle de la TV, une flèche clignoterait sans cesse sur les bords).
// Importé par table.js, donc transpilé pour Chromium 79 : rien de plus récent que lui.

const TRACES = 8; // points de la traînée, de plus en plus petits et pâles (leur opacité est dans la feuille)
const PAS_TRACE = 16; // millisecondes entre deux points de la traînée
const LISSAGE = 45; // millisecondes : le point rattrape la position reçue (20 par seconde) sans à-coups
const IMMOBILE = 4000; // millisecondes sans bouger : il s'estompe
const ESTOMPE = 1300; // durée du fondu de l'estompe (celle de la feuille, plus une marge)
const EFFACE = 450; // durée du fondu bref (Échap, souris sortie du plan, autre vue)
const ONDE = 900; // durée d'un cercle de l'onde ; le second part 180 ms après le premier

export class PointeurTv {
  // lissage : les millisecondes que met le point à rattraper la position reçue (la page Table du coin en reçoit 6 par
  // seconde, au lieu de 20 : elle le lisse davantage).
  constructor(racine, lissage) {
    this.racine = racine;
    this.lissage = lissage || LISSAGE;
    racine.innerHTML = `${Array.from({ length: TRACES }, () => '<i class="trace"></i>').join("")}<span class="ondes"><i class="onde"></i><i class="onde"></i></span><i class="point"></i>`;
    this.point = racine.querySelector(".point");
    this.traces = Array.from(racine.querySelectorAll(".trace"));
    this.ondes = racine.querySelector(".ondes");
    this.cercles = Array.from(racine.querySelectorAll(".onde"));
    this.cle = null; // "plan:<jeton>" ou "carte:<jeton>" : ce que montre le point
    this.de = 0; // l'éditeur qui pointe (un autre peut prendre la main ; seul celui-là efface)
    this.vue = null; // la vue (plan ou carte) qui place les coordonnées à l'écran
    this.cible = null; // la dernière position reçue
    this.ici = null; // la position lissée, celle qu'on voit
    this.passe = []; // les positions lissées récentes, pour la traînée : { x, y, t }
    this.onde = null; // { x, y, fin }
    this.dernier = 0; // heure de la dernière position reçue
    this.fin = 0; // heure où le fondu en cours est fini (0 : visible)
    this.raf = 0;
    this.avant = 0;
    this.ecrit = ""; // la dernière disposition écrite, pour ne rien réécrire d'identique
  }

  // Un message « pointeur » du serveur. vue : la vue qui montre ce plan ou cette carte en ce moment, sinon null (la
  // TV a changé de vue entre-temps : le message est ignoré).
  recevoir(msg, vue) {
    if (msg.efface) {
      if (msg.de === this.de) this.effacer();
      return;
    }
    if (!vue || typeof msg.x !== "number" || typeof msg.y !== "number") return;
    const cle = msg.plan ? `plan:${msg.plan}` : `carte:${msg.carte}`;
    const t = performance.now();
    // Un autre plan, ou un point déjà effacé : il apparaît là où il est, sans glisser depuis l'ancien endroit.
    if (cle !== this.cle || this.vue !== vue || !this.ici || this.fin) {
      this.ici = { x: msg.x, y: msg.y };
      this.passe = [];
    }
    this.cle = cle;
    this.de = msg.de;
    this.vue = vue;
    this.cible = { x: msg.x, y: msg.y };
    this.dernier = t;
    this.fin = 0;
    this.racine.classList.remove("estompe");
    this.racine.classList.add("visible");
    if (msg.onde) this.lancerOnde(msg.x, msg.y, t);
    this.demander();
  }

  // La TV montre désormais autre chose (cle : "plan:<jeton>", "carte:<jeton>" ou null) : un point d'ailleurs s'efface.
  garder(cle) {
    if (this.cle && cle !== this.cle) this.effacer();
  }

  // Fondu bref : Échap, souris sortie du plan, outil ou page quittés, autre vue à la TV.
  effacer() {
    if (!this.cle) return;
    this.cle = null;
    this.de = 0;
    this.disparaitre(EFFACE, false);
  }

  disparaitre(duree, estompe) {
    this.racine.classList.toggle("estompe", estompe);
    this.racine.classList.remove("visible");
    this.fin = performance.now() + duree;
    this.demander();
  }

  lancerOnde(x, y, t) {
    // Hors du cadre de l'écran, pas d'onde : ses cercles déborderaient seuls sur le bord.
    const [sx, sy] = this.vue.versEcran(x, y);
    if (!this.dansLeCadre(sx, sy)) return;
    this.onde = { x, y, fin: t + ONDE + 200 };
    this.ondes.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
    // L'animation par le navigateur (transform et opacity) : le compositeur la joue sans repeindre.
    this.cercles.forEach((c, i) => {
      if (!c.animate) return;
      c.animate([{ transform: "scale(.18)", opacity: 0.95 }, { transform: "scale(1)", opacity: 0 }],
        { duration: ONDE, delay: i * 180, easing: "cubic-bezier(.2, .7, .35, 1)", fill: "backwards" });
    });
  }

  demander() {
    if (this.raf) return;
    this.avant = performance.now();
    this.raf = requestAnimationFrame((t) => this.image(t));
  }

  image(t) {
    this.raf = 0;
    const dt = Math.max(0, Math.min(100, t - this.avant));
    this.avant = t;
    if (this.fin && t >= this.fin) {
      // Fondu fini : plus rien ne tourne jusqu'au prochain message.
      this.fin = 0;
      if (!this.cle) {
        this.vue = null;
        this.ici = null;
      }
      this.racine.classList.remove("estompe");
      this.passe = [];
      this.onde = null;
      return;
    }
    if (this.cle && !this.fin && t - this.dernier > IMMOBILE) {
      // Immobile depuis un moment : il s'estompe, et le prochain mouvement le rallume.
      this.cle = null;
      this.disparaitre(ESTOMPE, true);
    }
    if (this.ici && this.cible && this.vue) {
      const k = 1 - Math.exp(-dt / this.lissage);
      this.ici.x += (this.cible.x - this.ici.x) * k;
      this.ici.y += (this.cible.y - this.ici.y) * k;
      this.passe.push({ x: this.ici.x, y: this.ici.y, t });
      while (this.passe.length > 2 && this.passe[1].t < t - PAS_TRACE * (TRACES + 1)) this.passe.shift();
      this.disposer(t);
    }
    if (this.onde && t > this.onde.fin) this.onde = null;
    // Une seule boucle : disparaitre() a pu redemander l'image suivante.
    if ((this.cle || this.fin) && !this.raf) this.raf = requestAnimationFrame((u) => this.image(u));
  }

  // Le point, sa traînée et l'onde, placés en pixels d'écran d'après la caméra du moment.
  disposer(t) {
    const vue = this.vue;
    const [px, py] = vue.versEcran(this.ici.x, this.ici.y);
    const morceaux = [px, py];
    const places = this.traces.map((_, i) => {
      const [x, y] = this.passeA(t - PAS_TRACE * (i + 1));
      const [sx, sy] = vue.versEcran(x, y);
      morceaux.push(sx, sy);
      return [sx, sy];
    });
    let onde = null;
    if (this.onde) {
      onde = vue.versEcran(this.onde.x, this.onde.y);
      morceaux.push(onde[0], onde[1]);
    }
    // Rien ne bouge (point arrêté, caméra immobile) : aucune écriture dans la page.
    const cle = morceaux.map((v) => v.toFixed(1)).join(",");
    if (cle === this.ecrit) return;
    this.ecrit = cle;
    // Hors du cadre (ou presque), le point et sa traînée s'éteignent : son halo ne luit pas seul au bord de l'écran.
    const dehors = !this.dansLeCadre(px, py);
    if (dehors !== this.racine.classList.contains("dehors")) this.racine.classList.toggle("dehors", dehors);
    this.point.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    places.forEach(([x, y], i) => {
      this.traces[i].style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(1 - (i + 1) * 0.08).toFixed(2)})`;
    });
    if (onde) this.ondes.style.transform = `translate3d(${onde[0].toFixed(1)}px, ${onde[1].toFixed(1)}px, 0)`;
  }

  dansLeCadre(sx, sy) {
    return sx >= 0 && sy >= 0 && sx <= this.vue.lw && sy <= this.vue.lh;
  }

  // La position lissée à l'instant t (passé récent), entre deux images retenues.
  passeA(t) {
    const p = this.passe;
    if (!p.length) return [this.ici.x, this.ici.y];
    if (t <= p[0].t) return [p[0].x, p[0].y];
    for (let i = p.length - 1; i > 0; i--) {
      if (p[i - 1].t <= t) {
        const a = p[i - 1];
        const b = p[i];
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
      }
    }
    return [p[0].x, p[0].y];
  }
}
