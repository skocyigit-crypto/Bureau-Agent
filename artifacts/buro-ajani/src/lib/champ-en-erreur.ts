/**
 * Relier une erreur de saisie a son champ (RGAA 11.10 / WCAG 3.3.1).
 *
 * La plupart des formulaires signalaient un champ obligatoire vide par un
 * message ephemere (toast) : visible, et annonce par le lecteur d'ecran, mais
 * rien ne disait A QUEL champ il se rapportait. Le champ ne portait pas
 * d'etat d'erreur, ne recevait pas le focus, et le message disparaissait
 * avant qu'on l'ait retrouve.
 *
 * `signalerChamp` complete le toast, il ne le remplace pas :
 *  - le champ porte `aria-invalid="true"` ;
 *  - il pointe (`aria-describedby`) vers un texte durable qui repete le
 *    message — le toast, lui, s'efface ;
 *  - il recoit le focus ;
 *  - des qu'on y saisit quelque chose, l'etat d'erreur est leve.
 *
 * Le texte durable vit hors du formulaire (dans `document.body`) : React ne
 * le gere pas, et l'y inserer au milieu de ses propres noeuds pourrait
 * troubler son rendu. `aria-describedby` accepte n'importe quel identifiant
 * du document.
 */
export function signalerChamp(id: string, message: string): boolean {
  if (typeof document === "undefined") return false;
  const champ = document.getElementById(id);
  if (!champ) return false;

  const idMessage = `${id}-erreur`;
  let texte = document.getElementById(idMessage);
  if (!texte) {
    texte = document.createElement("span");
    texte.id = idMessage;
    texte.className = "sr-only";
    document.body.appendChild(texte);
  }
  texte.textContent = message;

  champ.setAttribute("aria-invalid", "true");
  champ.setAttribute("aria-describedby", idMessage);
  champ.focus();

  const lever = () => {
    champ.removeAttribute("aria-invalid");
    if (champ.getAttribute("aria-describedby") === idMessage) champ.removeAttribute("aria-describedby");
    texte?.remove();
  };
  champ.addEventListener("input", lever, { once: true });
  return true;
}
