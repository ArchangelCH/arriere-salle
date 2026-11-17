// Les articles d'une boutique, peints vus de face, en SVG (la TV, Chromium 79, les dessine sans peine) : de quoi voir
// une fiole, une épée ou une cotte de mailles sur les étagères de l'échoppe (table.js) et en vignette dans l'atelier
// (boutiques.js). Chaque objet tient dans un carré de 100 sur 100, posé sur sa base (y = 96) au milieu. Le dessin est
// celui que le MJ a choisi (article.dessin), sinon il se devine d'après le nom de l'article, puis sa catégorie.

const CONTOUR = "#2a1a0e";
const TRAIT = `stroke="${CONTOUR}" stroke-width="1.6" stroke-linejoin="round"`;
const TRAIT_FIN = `stroke="${CONTOUR}" stroke-width="1.1" stroke-linejoin="round"`;

// Les matières : des dégradés posés une fois par image (identifiants suffixés, plusieurs images par page).
function matieres(u, o) {
  const liquide = o.liquide || ["#ef6a5a", "#b02a1e", "#5e120c"];
  const cristal = o.cristal || ["#e6d4ff", "#9b6fe0", "#4b2a8c"];
  return `<defs>
    <radialGradient id="om${u}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="rgba(0,0,0,.42)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
    <linearGradient id="bo${u}" x1="0" x2="1"><stop offset="0" stop-color="#5e3b1f"/><stop offset=".38" stop-color="#b98451"/><stop offset=".7" stop-color="#8d5c32"/><stop offset="1" stop-color="#4f3119"/></linearGradient>
    <linearGradient id="fe${u}" x1="0" x2="1"><stop offset="0" stop-color="#3f4242"/><stop offset=".42" stop-color="#e3e6e4"/><stop offset=".62" stop-color="#9a9d9c"/><stop offset="1" stop-color="#383a3a"/></linearGradient>
    <linearGradient id="fv${u}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#dfe2e0"/><stop offset=".55" stop-color="#8a8d8c"/><stop offset="1" stop-color="#454747"/></linearGradient>
    <linearGradient id="cu${u}" x1="0" x2="1"><stop offset="0" stop-color="#4a2c16"/><stop offset=".42" stop-color="#a06b3c"/><stop offset="1" stop-color="#5f3a1d"/></linearGradient>
    <linearGradient id="la${u}" x1="0" x2="1"><stop offset="0" stop-color="#7a5420"/><stop offset=".45" stop-color="#f3cd78"/><stop offset="1" stop-color="#a87a32"/></linearGradient>
    <radialGradient id="vr${u}" cx="38%" cy="42%" r="70%"><stop offset="0" stop-color="rgba(240,248,250,.62)"/><stop offset=".6" stop-color="rgba(170,198,206,.28)"/><stop offset="1" stop-color="rgba(80,104,112,.45)"/></radialGradient>
    <radialGradient id="lq${u}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="${liquide[0]}"/><stop offset=".55" stop-color="${liquide[1]}"/><stop offset="1" stop-color="${liquide[2]}"/></radialGradient>
    <linearGradient id="cr${u}" x1="0" x2="1"><stop offset="0" stop-color="${cristal[2]}"/><stop offset=".5" stop-color="${cristal[1]}"/><stop offset="1" stop-color="${cristal[0]}"/></linearGradient>
    <radialGradient id="fl${u}" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff6c2"/><stop offset=".45" stop-color="#ffb43a"/><stop offset="1" stop-color="#d9481a"/></radialGradient>
    <radialGradient id="lu${u}" cx="50%" cy="60%" r="65%"><stop offset="0" stop-color="#fff2bf"/><stop offset=".5" stop-color="#f3b24a"/><stop offset="1" stop-color="#8a4a12"/></radialGradient>
    <linearGradient id="ju${u}" x1="0" x2="1"><stop offset="0" stop-color="#7d6338"/><stop offset=".45" stop-color="#c9ab72"/><stop offset="1" stop-color="#8a6e40"/></linearGradient>
    <pattern id="ma${u}" width="4" height="3.4" patternUnits="userSpaceOnUse"><circle cx="2" cy="1.7" r="1.45" fill="none" stroke="#2f3131" stroke-width=".7"/><circle cx="0" cy="0" r="1.45" fill="none" stroke="#2f3131" stroke-width=".7"/><circle cx="4" cy="0" r="1.45" fill="none" stroke="#2f3131" stroke-width=".7"/><circle cx="0" cy="3.4" r="1.45" fill="none" stroke="#2f3131" stroke-width=".7"/><circle cx="4" cy="3.4" r="1.45" fill="none" stroke="#2f3131" stroke-width=".7"/></pattern>
  </defs>`;
}

const ombre = (u, rx = 24, cy = 96) => `<ellipse cx="50" cy="${cy}" rx="${rx}" ry="${(rx * 0.16).toFixed(1)}" fill="url(#om${u})"/>`;
const reflet = (d, l = 2.4, a = 0.65) => `<path d="${d}" fill="none" stroke="rgba(255,255,255,${a})" stroke-width="${l}" stroke-linecap="round"/>`;

// Un support de bois pour une armure : un mât, une traverse aux épaules, un pied.
const support = (u) => `
  <path d="M33 95h34l-3-4H36z" fill="url(#bo${u})" ${TRAIT}/>
  <rect x="47.5" y="20" width="5" height="72" fill="url(#bo${u})" ${TRAIT}/>
  <rect x="30" y="22" width="40" height="5" rx="2" fill="url(#bo${u})" ${TRAIT}/>`;

// Une lame debout, pointe en haut : la dague et l'épée.
function lame(u, haut, demi, garde, poignee) {
  const base = haut + (88 - haut) * 0.78;
  return `${ombre(u, 12)}
  <path d="M50 ${haut}L${50 + demi} ${base - 4}L50 ${base}L${50 - demi} ${base - 4}Z" fill="url(#fe${u})" ${TRAIT}/>
  ${reflet(`M50 ${haut + 6}V${base - 5}`, 1.1, 0.55)}
  <path d="M${50 - garde} ${base}q${garde} -4 ${garde * 2} 0v5q-${garde} -3 -${garde * 2} 0z" fill="url(#la${u})" ${TRAIT}/>
  <rect x="46.2" y="${base + 5}" width="7.6" height="${poignee}" rx="2" fill="url(#cu${u})" ${TRAIT}/>
  <path d="M46.5 ${base + 9}l7 -3M46.5 ${base + 14}l7 -3M46.5 ${base + 19}l7 -3" stroke="rgba(30,16,8,.55)" stroke-width="1"/>
  <circle cx="50" cy="${base + poignee + 9}" r="4.6" fill="url(#la${u})" ${TRAIT}/>`;
}

const DESSINS = {
  fiole: (u) => `${ombre(u, 22)}
    <path d="M44 24h12v16c10 4 19 13 19 29c0 15-11 26-25 26S25 84 25 69c0-16 9-25 19-29z" fill="url(#vr${u})" ${TRAIT}/>
    <path d="M27.4 71c1.2 13 11 22.5 22.6 22.5S71.4 84 72.6 71c-8 3.4-37.2 3.4-45.2 0z" fill="url(#lq${u})"/>
    <path d="M27.4 71c8 3.4 37.2 3.4 45.2 0" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/>
    <rect x="42.5" y="13" width="15" height="10" rx="2.5" fill="url(#bo${u})" ${TRAIT}/>
    <rect x="41" y="21.5" width="18" height="4.5" rx="1.6" fill="#d8c8a2" ${TRAIT_FIN}/>
    <path d="M37 53h26v10H37z" fill="#efe2c2" ${TRAIT_FIN} transform="rotate(-4 50 58)"/>
    <path d="M41 57h18M42 60h12" stroke="rgba(60,40,20,.55)" stroke-width="1" transform="rotate(-4 50 58)"/>
    ${reflet("M33 66c0-8 3-13 8-16", 3)}<circle cx="64" cy="80" r="2.6" fill="rgba(255,255,255,.4)"/>`,

  trousse: (u) => `${ombre(u, 30)}
    <path d="M30 40q20-26 40 0" fill="none" stroke="#3d2412" stroke-width="5" stroke-linecap="round"/>
    <path d="M30 40q20-26 40 0" fill="none" stroke="#7a4c28" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="70" y="33" width="11" height="17" rx="4" fill="#f1e9d6" ${TRAIT}/>
    <path d="M71 38h9M71 43h9" stroke="rgba(90,70,40,.45)" stroke-width="1"/>
    <path d="M17 52q0-10 10-10h46q10 0 10 10v33q0 9-9 9H26q-9 0-9-9z" fill="url(#cu${u})" ${TRAIT}/>
    <path d="M17 54q0-12 12-12h42q12 0 12 12q-33 15-66 0z" fill="#6b4224" ${TRAIT}/>
    <path d="M21 88q29 4 58 0" fill="none" stroke="rgba(240,220,180,.55)" stroke-width="1" stroke-dasharray="2.4 2.2"/>
    <rect x="45" y="56" width="10" height="9" rx="1.5" fill="none" stroke="url(#la${u})" stroke-width="2.6"/>
    <path d="M30 72c3-6 8-8 12-6c-2 5-7 8-12 6z" fill="#6f8f4a" stroke="#2f3d1c" stroke-width=".9"/>
    <path d="M30 72l9-4" stroke="#2f3d1c" stroke-width=".8"/>`,

  dague: (u) => lame(u, 14, 5.5, 13, 17),
  epee: (u) => lame(u, 3, 6.8, 19, 15),

  hache: (u) => `${ombre(u, 18)}
    <path d="M47.5 18q-2.6 40 0 77h5.6q2.4-37 0-77z" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M47.5 80h5.4v8h-5.4z" fill="url(#cu${u})" ${TRAIT_FIN}/>
    <path d="M52.6 21h7q20-9 25 6q4 15-4 26q-7-11-21-9h-7z" fill="url(#fv${u})" ${TRAIT}/>
    <path d="M47.4 23h-6q-6 2-8 8q6 0 9 4h5z" fill="url(#fv${u})" ${TRAIT}/>
    ${reflet("M82 29q4 10-1 21", 2)}`,

  baton: (u) => `${ombre(u, 12)}
    <path d="M46.5 5q7 46-1 90h6.5q8-46 1-90z" fill="url(#bo${u})" ${TRAIT}/>
    <ellipse cx="50" cy="26" rx="2.2" ry="3.2" fill="#4f3119"/><ellipse cx="51.6" cy="68" rx="2" ry="3" fill="#4f3119"/>
    <path d="M47.3 45h7.4v12h-7.4z" fill="url(#cu${u})" ${TRAIT_FIN}/>
    <path d="M47.4 48l7.2-2M47.4 52l7.2-2M47.4 56l7.2-2" stroke="rgba(30,16,8,.5)" stroke-width=".9"/>
    <path d="M45.6 89h7.4l-.4 6h-6.6z" fill="url(#fe${u})" ${TRAIT_FIN}/>`,

  arc: (u) => `${ombre(u, 16)}
    <path d="M42 5L42 95" stroke="#efe4c8" stroke-width="1"/>
    <path d="M42 5q31 45 0 90" fill="none" stroke="${CONTOUR}" stroke-width="6.4" stroke-linecap="round"/>
    <path d="M42 5q31 45 0 90" fill="none" stroke="#9a6838" stroke-width="3.8" stroke-linecap="round"/>
    <path d="M44 9q24 41 0 82" fill="none" stroke="rgba(255,230,190,.35)" stroke-width="1"/>
    <rect x="53.5" y="43" width="7.5" height="14" rx="2" fill="url(#cu${u})" ${TRAIT}/>`,

  arbalete: (u) => `${ombre(u, 34)}
    <path d="M12 57h56q8 0 11 6l7 15H75l-6-10H12z" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M24 30q-11 30 0 60" fill="none" stroke="${CONTOUR}" stroke-width="6.4" stroke-linecap="round"/>
    <path d="M24 30q-11 30 0 60" fill="none" stroke="url(#fe${u})" stroke-width="3.8" stroke-linecap="round"/>
    <path d="M24 31L47 58L24 89" fill="none" stroke="#efe4c8" stroke-width="1.1"/>
    <path d="M14 59.5h50" stroke="rgba(30,16,8,.45)" stroke-width="1"/>
    <path d="M52 63q2 7-2 11" fill="none" stroke="url(#fe${u})" stroke-width="2.4"/>
    <rect x="44" y="55" width="6" height="5" rx="1" fill="url(#la${u})" ${TRAIT_FIN}/>`,

  fleches: (u, o) => {
    const plume = o.guerre ? ["#2a2a2a", "#7d7d7d"] : ["#b3261e", "#efe4c8"];
    const fleche = (x, h, a) => `<g transform="rotate(${a} 50 92)"><path d="M${x} ${h}V70" stroke="#c9a26a" stroke-width="1.8"/>
      <path d="M${x} ${h}l-4 7v6l4-4z" fill="${plume[0]}" stroke="${CONTOUR}" stroke-width=".7"/><path d="M${x} ${h}l4 7v6l-4-4z" fill="${plume[1]}" stroke="${CONTOUR}" stroke-width=".7"/></g>`;
    return `${ombre(u, 16)}${fleche(42, 10, -9)}${fleche(47, 6, -3)}${fleche(52, 8, 3)}${fleche(57, 12, 9)}${fleche(50, 15, 0)}
    <path d="M35 38l5 56h20l5-56z" fill="url(#cu${u})" ${TRAIT}/>
    <path d="M36 50h28M37.5 80h25" stroke="#3d2412" stroke-width="3"/>
    <path d="M35 38q15 5 30 0" fill="none" stroke="${CONTOUR}" stroke-width="1.4"/>`;
  },

  cuir: (u) => `${ombre(u, 20)}${support(u)}
    <path d="M30 28q20-8 40 0l7 11-7 5v33q-20 7-40 0V44l-7-5z" fill="url(#cu${u})" ${TRAIT}/>
    <path d="M43 26l7 13 7-13" fill="#3d2412" ${TRAIT_FIN}/>
    <path d="M36 44v30M64 44v30M50 40v36" stroke="rgba(240,220,180,.45)" stroke-width="1" stroke-dasharray="2.2 2"/>
    <rect x="30" y="62" width="40" height="6" fill="#4a2c16" ${TRAIT_FIN}/>
    <rect x="46.5" y="61" width="7" height="8" rx="1" fill="none" stroke="url(#la${u})" stroke-width="2"/>`,

  mailles: (u) => `${ombre(u, 20)}${support(u)}
    <path d="M30 28q20-8 40 0l9 9-6 9-3-2v34q-20 7-40 0V44l-3 2-6-9z" fill="#5d6060" ${TRAIT}/>
    <path d="M30 28q20-8 40 0l9 9-6 9-3-2v34q-20 7-40 0V44l-3 2-6-9z" fill="url(#ma${u})"/>
    <path d="M30 28q20-8 40 0l9 9-6 9-3-2v34q-20 7-40 0V44l-3 2-6-9z" fill="url(#fe${u})" opacity=".42"/>
    <path d="M42 26q8 8 16 0" fill="none" stroke="${CONTOUR}" stroke-width="1.3"/>`,

  plaques: (u) => `${ombre(u, 20)}${support(u)}
    <path d="M33 30q17-6 34 0q5 21-2 41q-15 7-30 0q-7-20-2-41z" fill="url(#fe${u})" ${TRAIT}/>
    <path d="M50 31v38" stroke="rgba(30,30,30,.45)" stroke-width="1.2"/>${reflet("M40 36q-3 14 0 28", 2.4, 0.55)}
    <path d="M24 33q3-12 15-8l2 9q-9 3-17-1z" fill="url(#fv${u})" ${TRAIT}/><path d="M76 33q-3-12-15-8l-2 9q9 3 17-1z" fill="url(#fv${u})" ${TRAIT}/>
    <path d="M35 71q15 6 30 0l1 6q-16 7-32 0z" fill="url(#fv${u})" ${TRAIT}/><path d="M36 77q14 6 28 0l1 6q-15 6-30 0z" fill="url(#fv${u})" ${TRAIT}/>
    <circle cx="37" cy="35" r="1.3" fill="url(#la${u})"/><circle cx="63" cy="35" r="1.3" fill="url(#la${u})"/><circle cx="38" cy="62" r="1.3" fill="url(#la${u})"/><circle cx="62" cy="62" r="1.3" fill="url(#la${u})"/>`,

  bouclier: (u) => `${ombre(u, 24)}
    <circle cx="50" cy="54" r="38" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M36 18v72M50 16v76M64 18v72" stroke="rgba(40,22,10,.5)" stroke-width="1.1"/>
    <circle cx="50" cy="54" r="38" fill="none" stroke="url(#fe${u})" stroke-width="4"/><circle cx="50" cy="54" r="40" fill="none" stroke="${CONTOUR}" stroke-width="1.2"/>
    <circle cx="50" cy="54" r="9" fill="url(#fe${u})" ${TRAIT}/>${reflet("M45 50q3-4 8-3", 1.8)}`,

  cheval: (u) => `${ombre(u, 32)}
    <path d="M24 94l8-30M76 94l-8-30M28 80h44" stroke="url(#bo${u})" stroke-width="5" stroke-linecap="round"/>
    <path d="M24 94l8-30M76 94l-8-30" stroke="${CONTOUR}" stroke-width=".8" fill="none"/>
    <path d="M18 54h64l-3 16H21z" fill="#8e1b17" ${TRAIT}/>
    <path d="M21 70v4M27 70v4M33 70v4M39 70v4M45 70v4M51 70v4M57 70v4M63 70v4M69 70v4M75 70v4" stroke="#e0b562" stroke-width="1.4"/>
    <path d="M22 52q6-16 20-10q8 5 16 0q14-6 20 10l-3 8q-25 7-50 0z" fill="url(#cu${u})" ${TRAIT}/>
    <path d="M30 47q20-9 40 0" fill="none" stroke="rgba(255,230,190,.35)" stroke-width="1.2"/>
    <path d="M50 58v16" stroke="#3d2412" stroke-width="2.4"/><path d="M44 74h12l-2 8h-8z" fill="none" stroke="url(#fe${u})" stroke-width="2.6"/>
    <path d="M78 22a9 9 0 1 1 -14 0" fill="none" stroke="url(#fe${u})" stroke-width="4" stroke-linecap="round"/>`,

  gemme: (u, o) => {
    const k = o.taille || 1;
    const prisme = (x, h, l, a) => `<g transform="translate(${x} 84) rotate(${a}) scale(${k})">
      <path d="M${-l} 0V${-h}L0 ${-h - l * 1.6}L${l} ${-h}V0z" fill="url(#cr${u})" ${TRAIT_FIN}/>
      <path d="M0 ${-h - l * 1.6}V0" stroke="rgba(255,255,255,.45)" stroke-width=".9"/><path d="M${-l} ${-h}L0 ${-h + l * 0.6}L${l} ${-h}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".8"/></g>`;
    return `${ombre(u, 28, 95)}
    <ellipse cx="50" cy="88" rx="28" ry="7.5" fill="#5a1e2a" ${TRAIT}/><ellipse cx="50" cy="86.5" rx="25" ry="5.5" fill="#7a2c3a"/>
    ${prisme(38, 22, 7, -22)}${prisme(62, 18, 6, 24)}${prisme(50, 36, 9, 0)}${prisme(44, 14, 5, -8)}${prisme(57, 12, 4.5, 10)}`;
  },

  corde: (u) => {
    let s = ombre(u, 28);
    for (let i = 0; i < 5; i++) {
      const y = 84 - i * 7;
      s += `<ellipse cx="50" cy="${y}" rx="25" ry="8" fill="none" stroke="${CONTOUR}" stroke-width="7.2"/>
        <ellipse cx="50" cy="${y}" rx="25" ry="8" fill="none" stroke="#b8925a" stroke-width="5"/>
        <ellipse cx="50" cy="${y}" rx="25" ry="8" fill="none" stroke="rgba(80,50,20,.55)" stroke-width="5" stroke-dasharray="1.6 2.6"/>`;
    }
    return `${s}<path d="M74 58q10 16 2 34" fill="none" stroke="${CONTOUR}" stroke-width="7.2" stroke-linecap="round"/>
      <path d="M74 58q10 16 2 34" fill="none" stroke="#b8925a" stroke-width="5" stroke-linecap="round"/>`;
  },

  vivres: (u) => `${ombre(u, 32)}
    <path d="M14 86q2-22 26-22q22 0 24 22z" fill="#c98a45" ${TRAIT}/>
    <path d="M24 72q3 4 0 8M34 68q3 5 0 10M44 69q3 5 0 9" stroke="#7a4a20" stroke-width="1.6" fill="none"/>
    <path d="M58 88l26-6-4-18z" fill="#f0c95a" ${TRAIT}/><circle cx="72" cy="78" r="2" fill="#c99a30"/><circle cx="66" cy="83" r="1.5" fill="#c99a30"/>
    <path d="M30 92q10-6 24 0" fill="none" stroke="${CONTOUR}" stroke-width="6.4" stroke-linecap="round"/><path d="M30 92q10-6 24 0" fill="none" stroke="#8a3424" stroke-width="4.4" stroke-linecap="round"/>`,

  cle: (u) => `${ombre(u, 22)}
    <g transform="rotate(-35 50 55)"><circle cx="50" cy="26" r="11" fill="none" stroke="url(#fe${u})" stroke-width="5"/><circle cx="50" cy="26" r="13.5" fill="none" stroke="${CONTOUR}" stroke-width=".8"/>
    <rect x="47.5" y="36" width="5" height="44" fill="url(#fe${u})" ${TRAIT_FIN}/><path d="M52 70h9v5h-4v5h-5zM52 60h7v5h-7z" fill="url(#fe${u})" ${TRAIT_FIN}/></g>
    <path d="M40 34q-10 14-6 30" fill="none" stroke="#c9b48a" stroke-width="1"/><path d="M26 62h18v24H26z" fill="#c69a62" ${TRAIT}/><path d="M30 70h10M30 76h7" stroke="rgba(60,30,10,.55)" stroke-width="1.2"/>`,

  sac: (u) => `${ombre(u, 26)}
    <path d="M32 40q-12 30-5 51q23 7 46 0q7-21-5-51q-18-7-36 0z" fill="url(#ju${u})" ${TRAIT}/>
    <path d="M36 52q14 4 28 0M33 66q17 5 34 0M32 80q18 4 36 0" stroke="rgba(80,60,30,.35)" stroke-width="1" fill="none"/>
    <path d="M36 40q14-10 28 0" fill="none" stroke="#5e3b1f" stroke-width="3.4"/><path d="M42 34q8-14 16 0" fill="#b39563" ${TRAIT_FIN}/>`,

  torche: (u) => `${ombre(u, 10)}
    <path d="M47 42L45.5 95h9L53 42z" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M43.5 34h13v12h-13z" fill="#6b4224" ${TRAIT}/><path d="M43.5 38h13M43.5 42h13" stroke="rgba(240,220,180,.35)" stroke-width="1"/>
    <path d="M50 3c8 10 13 18 9 27c-2 5-16 5-18 0c-4-9 2-15 9-27z" fill="url(#fl${u})" stroke="#8a2a0a" stroke-width="1"/>
    <path d="M50 14c4 6 6 10 4 15c-1 3-7 3-8 0c-2-5 0-9 4-15z" fill="#fff2b8" opacity=".85"/>`,

  lanterne: (u) => `${ombre(u, 16)}
    <circle cx="50" cy="14" r="5" fill="none" stroke="url(#fe${u})" stroke-width="2.6"/>
    <path d="M36 30L50 19L64 30z" fill="url(#fv${u})" ${TRAIT}/>
    <rect x="37" y="30" width="26" height="46" rx="2" fill="url(#lu${u})" ${TRAIT}/>
    <path d="M45.5 30v46M54.5 30v46" stroke="#2c2e2e" stroke-width="1.6"/>
    <path d="M50 46c3 4 4 7 2 10c-1 2-3 2-4 0c-2-3-1-6 2-10z" fill="#fffbe0"/>
    <rect x="35" y="76" width="30" height="7" rx="1.5" fill="url(#fe${u})" ${TRAIT}/>${reflet("M40 36v32", 1.6, 0.45)}`,

  livre: (u) => `${ombre(u, 26)}
    <path d="M66 92L72 46l6 2-6 46z" fill="#efe2c2" ${TRAIT}/><path d="M68 90l5-40M70 91l5-40" stroke="rgba(90,70,40,.35)" stroke-width=".8"/>
    <path d="M24 86l6-46 42 6-6 46z" fill="#7a2a1c" ${TRAIT}/>
    <path d="M28 62l42 6" stroke="url(#la${u})" stroke-width="3"/><path d="M27 70l42 6" stroke="url(#la${u})" stroke-width="1.4"/>
    <path d="M30 40l8 1-1 8-8-1zM24 86l8 1 1-8-8-1z" fill="url(#la${u})" ${TRAIT_FIN}/>${reflet("M33 46l-4 34", 1.6, 0.3)}`,

  outre: (u) => `${ombre(u, 24)}
    <path d="M30 48q24-24 46-6" fill="none" stroke="#3d2412" stroke-width="2.6"/>
    <path d="M36 40q-14 24-6 44q20 12 40 0q8-20-6-44q-14-6-28 0z" fill="url(#cu${u})" ${TRAIT}/>
    <path d="M44 28h12v13H44z" fill="#6b4224" ${TRAIT}/><rect x="45" y="20" width="10" height="9" rx="2" fill="url(#bo${u})" ${TRAIT_FIN}/>
    <path d="M34 84q16 6 32 0" fill="none" stroke="rgba(240,220,180,.4)" stroke-width="1" stroke-dasharray="2 2"/>${reflet("M38 54q-4 12 0 22", 2, 0.35)}`,

  lance: (u) => `${ombre(u, 10)}
    <path d="M48.5 24V96h3V24z" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M50 2l7 16-7 8-7-8z" fill="url(#fe${u})" ${TRAIT}/>${reflet("M50 6v16", 1, 0.6)}
    <rect x="47" y="25" width="6" height="5" rx="1" fill="url(#la${u})" ${TRAIT_FIN}/>
    <path d="M47 30q-6 8-3 16M53 30q6 8 3 16" fill="none" stroke="#8e1b17" stroke-width="2"/>`,

  marteau: (u) => `${ombre(u, 16)}
    <path d="M47.5 34V96h5V34z" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M47.5 80h5v9h-5z" fill="url(#cu${u})" ${TRAIT_FIN}/>
    <rect x="30" y="16" width="40" height="20" rx="3" fill="url(#fv${u})" ${TRAIT}/>
    <path d="M30 22h40" stroke="rgba(255,255,255,.45)" stroke-width="1.4"/><rect x="45" y="13" width="10" height="26" rx="2" fill="url(#fe${u})" ${TRAIT_FIN}/>`,

  coffret: (u) => `${ombre(u, 30)}
    <path d="M20 58h60v32H20z" fill="url(#bo${u})" ${TRAIT}/><path d="M20 58q30-26 60 0z" fill="url(#bo${u})" ${TRAIT}/>
    <path d="M20 58h60" stroke="${CONTOUR}" stroke-width="1.6"/><path d="M34 44v46M66 44v46" stroke="url(#la${u})" stroke-width="3.4"/>
    <rect x="45" y="60" width="10" height="12" rx="1.5" fill="url(#la${u})" ${TRAIT_FIN}/><circle cx="50" cy="65" r="1.5" fill="${CONTOUR}"/>`,
};

const MOTS = [
  [/potion|elixir|fiole|philtre|remede|tonique/, "fiole"],
  [/torche|flambeau/, "torche"],
  [/lanterne|lampe/, "lanterne"],
  [/livre|grimoire|parchemin|manuel|carte\b/, "livre"],
  [/outre|gourde/, "outre"],
  [/\blance\b|pique|hallebarde|epieu/, "lance"],
  [/marteau|masse|maillet|fleau/, "marteau"],
  [/coffre|coffret|boite|cassette/, "coffret"],
  [/\bsac\b|besace|bourse|sacoche/, "sac"],
  [/trousse|kit|bandage|onguent|soin/, "trousse"],
  [/dague|couteau|poignard/, "dague"],
  [/epee|sabre|rapiere|glaive/, "epee"],
  [/hache|hachette/, "hache"],
  [/baton|canne|sceptre|bourdon/, "baton"],
  [/arbalete/, "arbalete"],
  [/fleche|carreau/, "fleches"],
  [/\barc\b/, "arc"],
  [/bouclier|ecu\b|targe/, "bouclier"],
  [/maille/, "mailles"],
  [/plaque|cuirasse|harnois/, "plaques"],
  [/cuir|armure/, "cuir"],
  [/cheval|monture|poney|mule|\bane\b/, "cheval"],
  [/gemme|cristal|rubis|saphir|emeraude|diamant|pierre precieuse/, "gemme"],
  [/corde|grappin/, "corde"],
  [/\blit\b|chambre|nuit/, "cle"],
  [/pain|vivre|ration|fromage|repas/, "vivres"],
];
const PAR_CATEGORIE = { armes: "epee", armures: "cuir", equipement: "sac", "soins et potions": "fiole", vivres: "vivres", montures: "cheval", services: "cle", curiosites: "coffret" };
const forme = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Les dessins, pour le choix du MJ dans l'atelier (même liste que le serveur, api/tv_boutique_combat.py, DESSINS_ARTICLE).
export const NOMS_DESSINS = [
  ["fiole", "Fiole"], ["trousse", "Trousse de soins"], ["dague", "Dague"], ["epee", "Épée"], ["hache", "Hache"], ["baton", "Bâton"],
  ["arc", "Arc"], ["arbalete", "Arbalète"], ["fleches", "Flèches"], ["lance", "Lance"], ["marteau", "Marteau ou masse"],
  ["bouclier", "Bouclier"], ["cuir", "Armure de cuir"], ["mailles", "Cotte de mailles"], ["plaques", "Armure de plaques"],
  ["cheval", "Cheval (selle)"], ["gemme", "Gemmes"], ["corde", "Corde"], ["torche", "Torche"], ["lanterne", "Lanterne"],
  ["livre", "Livre"], ["outre", "Outre"], ["vivres", "Vivres"], ["cle", "Chambre (clé)"], ["sac", "Sac"], ["coffret", "Coffret"],
];

// Le dessin d'un article, et ses variantes : la couleur d'une potion, la taille d'une gemme, des flèches de guerre.
export function typeObjet(a) {
  if (a.dessin && DESSINS[a.dessin]) return a.dessin;
  const nom = forme(a.nom);
  for (const [re, cle] of MOTS) if (re.test(nom)) return cle;
  return PAR_CATEGORIE[forme(a.categorie)] || "sac";
}

function variantes(a, cle) {
  const nom = forme(`${a.nom} ${a.description || ""}`);
  const o = {};
  if (cle === "fiole") {
    if (/mana|psy|esprit/.test(nom)) o.liquide = ["#7fb4ff", "#2a5fbf", "#122a5e"];
    else if (/poison|venin/.test(nom)) o.liquide = ["#a8e070", "#4f8a2a", "#1f3d10"];
  }
  if (cle === "gemme") o.taille = /\bs\b|petite/.test(forme(a.nom)) ? 0.72 : /\bm\b|moyenne/.test(forme(a.nom)) ? 0.86 : 1;
  if (cle === "fleches") o.guerre = /guerre|perce/.test(nom);
  return o;
}

let compteur = 0;
export function objetSvg(a, classe = "objet") {
  const cle = typeObjet(a);
  const o = variantes(a, cle);
  const u = `o${++compteur}`;
  return `<svg class="${classe} objet-${cle}" viewBox="0 0 100 100" aria-hidden="true">${matieres(u, o)}${DESSINS[cle](u, o)}</svg>`;
}
