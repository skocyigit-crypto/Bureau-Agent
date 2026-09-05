import { createRoot } from "react-dom/client";
import App from "./App";
// Inter, servie par nos soins: les six graisses reellement utilisees
// (400/500/600/700/800/900), pas la famille entiere. Importee ici plutot que dans
// index.html pour que Vite empaquette les .woff2 et les serve depuis notre
// propre domaine — aucune requete vers Google, donc aucune adresse IP
// transmise a un tiers avant consentement. Le tribunal regional de Munich
// (LG Munchen I, 3 O 17493/20) a juge ce seul appel suffisant pour
// caracteriser une atteinte.
//
// Cette explication vivait aussi dans index.html, en commentaire HTML. Les
// commentaires HTML ne sont pas retires a la compilation: elle partait donc
// dans CHAQUE reponse, a chaque visiteur, et publiait sur le site de
// production le recit d'un defaut de confidentialite passe. Elle appartient
// au code, pas a la page.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
// 800 et 900: le site les utilise reellement (19 emplois de font-extrabold /
// font-black). Ils venaient jusqu ici de la feuille de style de Google, via un
// @import reste en tete de index.css. Les retirer sans les remplacer aurait
// fait synthetiser ces graisses a partir du 700 par le navigateur — une
// regression visible, la ou on ne corrigeait qu une fuite invisible.
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
