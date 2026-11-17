"""L'inventaire des joueurs dans l'atelier : ce que la file des demandes (boite.py) fait des gestes du sac et des
dons (inventaire.py), le journal qui permet de les annuler, et le découpage du sac tel que le joueur le voit.

- « sac » et « don-objet » s'appliquent seuls : le geste est rejoué sur le sac du moment, par la route du sac de l'atelier
  (changer, le cœur de PATCH /api/aventuriers/{id}/sac), chaque champ avec sa valeur d'avant. Un don touche deux sacs
  d'un seul coup : si l'un des deux a changé, rien ne bouge.
- « don-or » attend le MJ ; à l'acceptation, la bourse est revérifiée.
- Chaque geste appliqué est noté dans data/journal-sac.jsonl avec les listes d'avant et d'après : « Annuler » (boîte du MJ)
  rejoue l'inverse, et refuse si le sac a changé depuis.
- Après un geste, seules les fiches « Mon héros » des héros touchés sont republiées, avant même que le statut de la
  demande ne parte : quand le joueur lit « fait », son sac est déjà à jour. Les pages de l'atelier (le Tableau, « La
  compagnie ») sont prévenues par leur canal (message {"type": "sac"}).

Le joueur ne voit de son sac que les lignes que publie l'atelier (vues) : sans les lignes vides, au masque, sans ce qui
nomme un inconnu. Ce qu'il a écrit lui-même lui revient tel quel : qu'une ligne tapée par lui disparaisse ou change dirait
qu'elle nomme un secret.

Les quantités (« Torche ×3 », inventaire.quantite_de) ne changent rien à cette règle : une ligne « écrite par lui » se
reconnaît à son nom, quel que soit son compte (un de plus, par lui ou par le MJ, ne la fait pas repasser au masque). À
l'inverse, un ajout qui grossit une ligne déjà là ne la marque pas « écrite » : il n'a tapé que ce qu'il en lisait, et le
vrai texte de la ligne, s'il diffère, reste au masque.

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import hmac
import json
import logging
import threading
import time
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import HTTPException

from commun import demandes
from commun import inventaire
from commun.demandes import Refus
from table.masque import masquer, secrets_dans
from commun import stockage

journal = logging.getLogger("atelier.sacs")


def cite(texte: str) -> str:
    """« texte », les guillemets tenus à leur texte par des espaces insécables (une phrase lue au téléphone)."""
    return f"«\u00a0{texte}\u00a0»"

JOURNAL_OCTETS_MAX = 4 * 1024 * 1024  # au-delà, la moitié la plus ancienne s'en va
NOMS_DUREE = 2.0  # secondes : les prénoms de la boîte se relisent au plus aussi souvent


class Sacs:
    def __init__(self, donnees: Path, *, sac_de: Callable, changer: Callable[[dict], dict], heros_du_joueur: Callable,
                 tablee: Callable[[], list], ref: Callable[[str], str], candidats: Callable[[], list],
                 noms_secrets: Callable[[list], str], publier: Callable[[set], object], carnet_ouvert: Callable[[], bool],
                 signaler: Callable[[dict], Awaitable[None]]):
        self.fichier = donnees / "journal-sac.jsonl"
        self.sac_de = sac_de
        self.changer = changer
        self.heros_du_joueur = heros_du_joueur
        self.tablee = tablee
        self.ref = ref
        self.candidats = candidats
        self.noms_secrets = noms_secrets
        self.publier = publier
        self.carnet_ouvert = carnet_ouvert
        self.signaler = signaler
        self.verrou = threading.Lock()
        self.cache_journal = (None, [])
        self.cache_noms = (0.0, {})
        self.touches: dict[str, set] = {}  # demande → héros touchés, pour prévenir les pages de l'atelier ensuite

    def brancher(self, boite) -> None:
        boite.brancher("sac", appliquer=self.appliquer_sac, annuler=self.annuler, apres=self.apres, dire=self.dire)
        boite.brancher("don-objet", appliquer=self.appliquer_don_objet, annuler=self.annuler, apres=self.apres, dire=self.dire)
        boite.brancher("don-or", accepter=self.accepter_don_or, apres=self.apres, dire=self.dire)

    # ------------------------------------------------------------ le journal

    def lignes(self) -> list:
        """Les entrées du journal, gardées en mémoire tant que le fichier ne bouge pas."""
        try:
            st = self.fichier.stat()
        except OSError:
            return []
        cle = (st.st_ino, st.st_size, st.st_mtime_ns)
        if self.cache_journal[0] == cle:
            return self.cache_journal[1]
        entrees = []
        try:
            with open(self.fichier, encoding="utf-8") as f:
                for ligne in f:
                    try:
                        e = json.loads(ligne)
                    except ValueError:
                        continue
                    if isinstance(e, dict) and isinstance(e.get("demande"), str) and isinstance(e.get("sacs"), dict):
                        entrees.append(e)
        except OSError:
            return []
        self.cache_journal = (cle, entrees)
        return entrees

    def noter(self, entree: dict) -> None:
        with self.verrou:
            self.fichier.parent.mkdir(parents=True, exist_ok=True)
            ligne = json.dumps(entree, ensure_ascii=False, separators=(",", ":")) + "\n"
            try:
                trop = self.fichier.stat().st_size + len(ligne.encode()) > JOURNAL_OCTETS_MAX
            except OSError:
                trop = False
            if trop:
                garde = self.fichier.read_text(encoding="utf-8").splitlines(keepends=True)
                stockage.ecrire_texte(self.fichier, "".join(garde[len(garde) // 2:]) + ligne)
            else:
                with open(self.fichier, "a", encoding="utf-8") as f:
                    f.write(ligne)

    def entree(self, joueur: str, ident: str) -> dict | None:
        annulees = {e["demande"] for e in self.lignes() if e.get("annule") and e.get("joueur") == joueur}
        if ident in annulees:
            return None
        return next((e for e in reversed(self.lignes()) if e["demande"] == ident and e.get("joueur") == joueur and not e.get("annule")), None)

    def ecrits(self, heros: str, joueur: str) -> set:
        """Les noms des lignes que ce joueur a écrites lui-même dans le sac de ce héros (gestes non annulés), sans leur
        quantité. Celles d'un autre joueur (le héros confié depuis à quelqu'un d'autre) ne lui reviennent pas : il ne les a
        pas écrites."""
        annulees = {(e.get("joueur"), e["demande"]) for e in self.lignes() if e.get("annule")}
        textes = set()
        for e in self.lignes():
            if e.get("annule") or e.get("joueur") != joueur or (e.get("joueur"), e["demande"]) in annulees:
                continue
            ecrit = e.get("ecrit") if isinstance(e.get("ecrit"), dict) else {}
            textes |= {inventaire.quantite_de(t)[0] for t in ecrit.get(heros) or [] if isinstance(t, str)}
        return textes

    # ------------------------------------------------------------ le sac tel que le joueur le voit

    def inconnus(self, a: dict, candidats: list) -> list:
        """Ce qui ne doit pas paraître dans son sac : les PNJ et lieux inconnus, le peuple caché d'un autre (le sien n'est
        pas un secret pour lui), comme retenir_recit de main.py."""
        aid = a.get("id")
        return [(s, formes) for s, formes in candidats
                if s.get("genre") in ("pnj", "lieu") or (s.get("genre") == "peuple" and aid not in s.get("ids", []))]

    def vues(self, a: dict, cle: str, candidats: list, joueur: str, retenus: list | None = None, quoi: str = "") -> list:
        """[(rang dans la fiche, texte que lit le joueur)] : la liste du sac sans ses lignes vides, au masque, sans les
        lignes qui nomment un inconnu. Ce que le joueur a écrit lui-même lui revient tel qu'il l'a écrit. retenus : les
        phrases pour le MJ (l'onglet Carnet), quand on publie. joueur : celui qui lit ce sac."""
        ecrits = self.ecrits(a.get("id", ""), joueur)
        inconnus = self.inconnus(a, candidats)
        vues = []
        for i, x in enumerate(self.sac_de(a, cle)):
            if not x.strip():
                continue
            if inventaire.quantite_de(x)[0] in ecrits:
                vues.append((i, x))
                if retenus is not None and (trouves := secrets_dans(x, inconnus)):
                    retenus.append(f"{quoi} : son joueur a noté « {x} » dans son sac, qui nomme {self.noms_secrets(trouves)}. "
                                   "Il le lit, puisqu'il l'a écrit lui-même.")
                continue
            vu = masquer(x)
            trouves = secrets_dans(vu, inconnus)
            if trouves:
                if retenus is not None:
                    retenus.append(f"{quoi} : une ligne de son sac est retenue, elle nomme {self.noms_secrets(trouves)}.")
                continue
            vues.append((i, vu))
        return vues

    def publiees(self, a: dict, candidats: list, retenus: list, quoi: str, joueur: str) -> dict:
        """L'équipement et les objets personnels de « Mon héros », tels que le carnet les publie pour son joueur."""
        return {cle: [vu for _, vu in self.vues(a, cle, candidats, joueur, retenus, quoi)] for cle in inventaire.LISTES}

    # ------------------------------------------------------------ appliquer

    def heros(self, j: dict) -> dict:
        a = self.heros_du_joueur(j["id"])
        if not a:
            raise Refus(409, "Votre héros n'est pas à la tablée en ce moment : votre MJ s'en occupera.")
        return a

    def compagnon(self, ref: str) -> dict | None:
        return next((a for a in self.tablee() if hmac.compare_digest(self.ref(a["id"]), ref)), None)

    def ouvert(self) -> None:
        if not self.carnet_ouvert():
            raise Refus(423, "Le carnet est fermé : votre MJ le rouvre entre les séances.")

    def ecrire(self, corps: dict) -> dict:
        """La route du sac, pour un ou deux héros d'un coup. Un refus de la route (un sac qui a changé entre-temps) devient
        une phrase pour le joueur."""
        try:
            return self.changer(corps)
        except HTTPException as err:
            if err.status_code == 409:
                raise Refus(409, "Le sac a changé au même moment sur un autre écran : rien n'a bougé, réessayez.")
            if err.status_code == 404:
                raise Refus(409, "Un des héros de ce geste n'est plus dans l'atelier : votre MJ s'en occupera.")
            raise Refus(err.status_code, str(err.detail))

    def apres_geste(self, j: dict, d: dict, sacs: dict, ecrit: dict | None = None, par: str = "joueur", annule: bool = False) -> None:
        """Journal, puis fiches « Mon héros » republiées tout de suite (une publication manquée se rattrape au passage
        suivant de la tâche du carnet)."""
        entree = {"quand": demandes.maintenant(), "demande": d["id"], "joueur": j["id"], "genre": d["genre"], "par": par, "sacs": sacs}
        if ecrit:
            entree["ecrit"] = ecrit
        if annule:
            entree["annule"] = True
        self.noter(entree)
        ids = set(sacs)
        self.touches[d["id"]] = ids
        try:
            self.publier(ids)
        except Exception:
            journal.exception("Fiches « Mon héros » non republiées après un geste de sac")

    def appliquer_sac(self, j: dict, d: dict) -> str:
        self.ouvert()
        corps = d["corps"]
        a = self.heros(j)
        cle = corps["liste"]
        changes = inventaire.rejouer(self.sac_de(a, cle), self.vues(a, cle, self.candidats(), j["id"]), corps)
        if not changes:
            return "Rien à changer : votre sac était déjà ainsi."
        self.ecrire({a["id"]: changes})
        ancienne, nouvelle = inventaire.touchee(changes[cle])
        # Écrit par lui : la ligne qu'il a tapée. Pas celle qu'un ajout a grossie (il n'en a tapé que ce qu'il lisait), ni
        # celle dont il change le compte (elle garde son statut, par son nom).
        grossie = corps["geste"] == "ajouter" and bool(ancienne.strip())
        ecrit = {a["id"]: [nouvelle]} if corps.get("ligne") and nouvelle and not grossie else None
        self.apres_geste(j, d, {a["id"]: changes}, ecrit)
        dans = inventaire.NOMS_LISTES[cle]
        if corps["geste"] == "ajouter":
            if grossie:
                # Ce qu'il lit de la ligne, jamais son texte brut : le nom tel qu'il l'a tapé, le compte du sac.
                return f"Ajouté à {dans} : {cite(corps['ligne'])}. Vous en avez {inventaire.quantite_de(nouvelle)[1]}."
            return f"Ajouté à {dans} : {cite(corps['ligne'])}."
        if corps["geste"] == "changer":
            return f"{cite(corps['avant'])} devient {cite(corps['ligne'])}."
        if corps["geste"] == "quantite":
            nom, reste = inventaire.quantite_de(corps["avant"])[0], inventaire.quantite_de(nouvelle)[1] if nouvelle else 0
            if not reste:
                return f"Retiré de {dans} : {cite(nom)}."
            if corps["de"] > 0:
                return f"{cite(nom)} : un de plus, vous en avez {reste}."
            return f"{cite(nom)} : un de moins, il vous en reste {reste}."
        return f"Retiré de {dans} : {cite(corps['avant'])}."

    def appliquer_don_objet(self, j: dict, d: dict) -> str:
        self.ouvert()
        corps = d["corps"]
        a = self.heros(j)
        dest = self.compagnon(corps["ref"])
        if not dest:
            raise Refus(409, "Ce compagnon n'est plus dans la compagnie.")
        if dest["id"] == a["id"]:
            raise Refus(400, "Ce sac est déjà le vôtre.")
        cle = corps["liste"]
        brute = self.sac_de(a, cle)
        i = inventaire.ligne_visee(self.vues(a, cle, self.candidats(), j["id"]), corps["rang"], corps["avant"])
        if i is None:
            raise Refus(409, inventaire.PLUS_LA)
        objet = brute[i]
        nombre = corps.get("nombre")
        nom, n = inventaire.quantite_de(objet)
        partiel = nombre is not None and cle == "equipement" and not inventaire.douteuse(objet) and nombre < n
        if nombre is not None and not partiel and (cle != "equipement" or inventaire.douteuse(objet) or nombre > n):
            # Il en demande plus qu'il n'en reste (un autre geste est passé avant) : rien ne part.
            raise Refus(409, inventaire.PLUS_AUTANT)
        if partiel:
            # Quelques exemplaires seulement : la ligne garde le reste, le compagnon reçoit « Nom ×nombre ».
            donne = inventaire.rejouer(brute, [(i, corps["avant"])], {"geste": "quantite", "liste": cle, "rang": 0, "avant": corps["avant"], "de": -nombre})
            objet = inventaire.ligne(nom, nombre)
        else:
            donne = inventaire.rejouer(brute, [(i, corps["avant"])], {"geste": "retirer", "liste": cle, "rang": 0, "avant": corps["avant"]})
        recoit = self.sac_de(dest, "equipement")
        qui = inventaire.prenom(dest.get("nom"))
        # Déjà dans le sac du compagnon (même nom) : sa quantité monte. Sinon, une ligne de plus, telle qu'elle était.
        deja = None if inventaire.douteuse(objet) else inventaire.rang_du_nom(list(enumerate(recoit)), inventaire.quantite_de(objet)[0])
        if deja is not None:
            recu = list(recoit)
            try:
                recu[deja] = inventaire.comptee(recoit[deja], inventaire.quantite_de(objet)[1])
            except Refus:
                raise Refus(409, f"Le sac de {masquer(qui)} en a déjà trop.")
        elif len(recoit) >= inventaire.LIGNES_MAX:
            raise Refus(409, f"Le sac de {qui} est plein.")
        else:
            recu = [*recoit, objet]
        changes = {a["id"]: donne, dest["id"]: {"equipement": {"avant": recoit, "apres": recu}}}
        self.ecrire(changes)
        self.apres_geste(j, d, changes)
        quoi = corps["avant"] if not partiel else inventaire.ligne(inventaire.quantite_de(corps["avant"])[0], nombre)
        return f"{cite(quoi)} donné à {masquer(qui)}."

    def accepter_don_or(self, j: dict, d: dict, _mot: str) -> str:
        corps = d["corps"]
        a = self.heros(j)
        dest = self.compagnon(corps["ref"])
        if not dest:
            raise Refus(409, "Ce compagnon n'est plus dans la compagnie : refusez ce don.")
        if dest["id"] == a["id"]:
            raise Refus(400, "Ce don va au héros même qui le fait : refusez-le.")
        montant = corps["montant"]
        bourse, autre = self.sac_de(a, "or") or 0, self.sac_de(dest, "or") or 0
        if bourse < montant:
            raise Refus(409, f"La bourse de {inventaire.prenom(a.get('nom'))} n'a plus que {bourse} po : ce don ne passe pas. "
                             "Refusez-le, ou changez la bourse d'abord.")
        if autre + montant > inventaire.OR_MAX:
            raise Refus(409, "La bourse du compagnon déborderait.")
        changes = {a["id"]: {"or": {"avant": bourse, "apres": bourse - montant}}, dest["id"]: {"or": {"avant": autre, "apres": autre + montant}}}
        self.ecrire(changes)
        self.apres_geste(j, d, changes, par="mj")
        return f"{montant} po données à {masquer(inventaire.prenom(dest.get('nom')))}."

    def annuler(self, j: dict, d: dict) -> str:
        """L'inverse du geste, avec la valeur d'avant : si un des sacs a changé depuis, rien ne bouge et le MJ le lit."""
        e = self.entree(j["id"], d["id"])
        if not e:
            raise Refus(409, "Ce geste n'est plus dans le journal du sac : corrigez le sac à la main dans « La compagnie ».")
        inverse = {hid: {cle: {"avant": v["apres"], "apres": v["avant"]} for cle, v in champs.items()} for hid, champs in e["sacs"].items()}
        try:
            self.changer(inverse)
        except HTTPException as err:
            if err.status_code == 404:
                raise Refus(409, "Un des héros de ce geste n'existe plus : rien n'est annulé.")
            if err.status_code == 409:
                raise Refus(409, "Le sac a changé depuis ce geste : rien n'est annulé. Corrigez-le à la main dans « La compagnie ».")
            raise Refus(err.status_code, str(err.detail))
        self.apres_geste(j, d, inverse, par="mj", annule=True)
        return "Votre MJ a annulé ce geste : votre sac est revenu comme avant."

    async def apres(self, liste: list) -> None:
        """Après une vague de gestes (ou un geste du MJ dans la boîte) : les pages de l'atelier relisent ces sacs."""
        ids = set()
        for _, d in liste:
            ids |= self.touches.pop(d["id"], set())
        if ids:
            await self.signaler({"type": "sac", "heros": sorted(ids)})

    # ------------------------------------------------------------ la boîte du MJ

    def noms(self) -> dict:
        """{ref : prénom} des héros de la tablée, relu au plus toutes les deux secondes : la boîte se dessine souvent."""
        quand, noms = self.cache_noms
        if time.monotonic() - quand < NOMS_DUREE:
            return noms
        noms = {self.ref(a["id"]): inventaire.prenom(a.get("nom")) for a in self.tablee() if isinstance(a.get("id"), str)}
        self.cache_noms = (time.monotonic(), noms)
        return noms

    def dire(self, j: dict, d: dict) -> str:
        """La ligne de la boîte : « Camille a ajouté « Corde de 15 m » », « Sacha donne 20 po à Aldo »."""
        c = d.get("corps") or {}
        qui = j.get("nom") or "Le joueur"
        if d.get("genre") == "sac":
            dans = " à ses objets personnels" if c.get("liste") == "objets" else ""
            if c.get("geste") == "ajouter":
                return f"{qui} a ajouté « {c.get('ligne', '')} »{dans}"
            if c.get("geste") == "changer":
                return f"{qui} a renommé « {c.get('avant', '')} » en « {c.get('ligne', '')} »"
            if c.get("geste") == "quantite":
                nom = inventaire.quantite_de(c.get("avant", ""))[0]
                return f"{qui} a ajouté 1 à « {nom} »" if c.get("de") == 1 else f"{qui} a retiré 1 de « {nom} »"
            return f"{qui} a retiré « {c.get('avant', '')} »"
        a_qui = self.noms().get(c.get("ref"), "un compagnon")
        if d.get("genre") == "don-objet":
            if inventaire.entier(c.get("nombre")):
                return f"{qui} donne « {inventaire.ligne(inventaire.quantite_de(c.get('avant', ''))[0], c['nombre'])} » à {a_qui}"
            return f"{qui} donne « {c.get('avant', '')} » à {a_qui}"
        if d.get("genre") == "don-or":
            if d.get("statut") != demandes.EN_ATTENTE:
                return f"{qui} {'a donné' if d.get('statut') == demandes.ACCEPTEE else 'voulait donner'} {c.get('montant', 0)} po à {a_qui}"
            # Ce qui attend le MJ dit la bourse du moment : il tranche sans aller la chercher.
            a = self.heros_du_joueur(j.get("id", ""))
            bourse = f" (sa bourse : {self.sac_de(a, 'or') or 0} po)" if a else ""
            return f"{qui} donne {c.get('montant', 0)} po à {a_qui}{bourse}"
        return ""
