// Le rôle du MJ de cette page. Le serveur le pose sur la page de l'atelier d'un MJ invité
// (<body data-role="invite">, api/pages.py) ; le compte principal reçoit la page telle qu'elle était et garde tout son atelier.
// Pour l'interface seulement : le serveur tient les droits (acces_mj.py), et ce qu'un invité n'a pas lui répond 404.
// Hors d'une page (les vérifieurs sous Node), c'est le compte principal.

export const estInvite = () => typeof document !== "undefined" && document.body?.dataset.role === "invite";
