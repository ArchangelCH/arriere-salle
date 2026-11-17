// Les portraits des listes en version réduite : un médaillon de 40 px ne doit pas tirer une image de 190 Ko.
// /api/table/vignette (vignettes.py) donne un WebP de 160, 320 ou 640 pixels de large, gardé par le serveur ; l'original
// reste sur le disque, et la fiche entière (impression, éditeur) continue de le charger. Hors de l'atelier (la TV, le
// coin des joueurs), l'adresse n'est pas touchée.
const MEDIA = /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;

export function miniature(url, largeur = 160) {
  const m = typeof url === "string" && document.body?.classList.contains("atelier") ? MEDIA.exec(url) : null;
  return m ? `/api/table/vignette/${m[1]}?l=${largeur}&f=webp` : url;
}

// Les attributs d'une image de liste : réduite, chargée quand elle approche de l'écran, décodée hors du fil principal.
// `cote` : largeur et hauteur affichées en pixels, pour réserver la place avant l'arrivée de l'image.
export function attributsMiniature(url, largeur = 160, cote = 0) {
  const dim = cote ? ` width="${cote}" height="${cote}"` : "";
  return `src="${miniature(url, largeur).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c])}" loading="lazy" decoding="async"${dim}`;
}
