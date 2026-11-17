// L'aperçu à l'écran d'une feuille à imprimer (fiche de séance, feuille de combat, documents) : la feuille garde sa forme de
// papier, mais se réduit à la largeur de l'écran quand celui-ci est plus étroit qu'elle (téléphone, petite tablette), au
// lieu de forcer un défilement de côté. Seul l'écran change : à l'impression, la feuille reste à sa taille (feuille.css :
// zoom: 1 !important).

const PX_PAR_MM = 96 / 25.4;

// selecteur : les feuilles ; largeurMm : leur largeur de papier. Rend la fonction qui remesure (à rappeler quand les
// feuilles sont dessinées ou changent de format).
export function apercuALEcran(selecteur, largeurMm) {
  let largeur = largeurMm;
  const maj = (nouvelleLargeurMm) => {
    if (typeof nouvelleLargeurMm === "number") largeur = nouvelleLargeurMm;
    const place = document.documentElement.clientWidth - 24;
    const k = Math.min(1, place / (largeur * PX_PAR_MM));
    document.querySelectorAll(selecteur).forEach((el) => {
      el.style.zoom = k < 0.995 ? k.toFixed(3) : "";
    });
  };
  window.addEventListener("resize", () => maj());
  maj();
  return maj;
}
