/**
 * Les petites animations de la visite guidée (une par étape) : elles MONTRENT la fonction au lieu de la décrire. Traits
 * de 1,8 comme les icônes de l'application, angles vifs (Trait net), encre et couleur de l'application seulement.
 * Repris de ProjectLead (carte, accueil, horloge, réglages, conversation, menu) ; propres à InvoiceLead : devis qui
 * devient facture, facture envoyée puis relancée, contacts et articles, journal qui se remplit, applications Lead.
 * Aucun texte dedans (rien à traduire). Le mouvement vit dans tour.css ; avec prefers-reduced-motion, chaque dessin
 * reste sur son image finale, qui se lit seule.
 */
import type { ReactElement } from "react";

export type ArtName =
  | "map"
  | "home"
  | "quote"
  | "invoice"
  | "clock"
  | "contacts"
  | "ledger"
  | "toggles"
  | "apps"
  | "chat"
  | "menu";

const S = {
  fill: "none",
  stroke: "var(--plt-ink)",
  strokeWidth: 1.8,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
};
const A = { ...S, stroke: "var(--plt-accent)" };

function ScreenMap() {
  return (
    <g>
      {/* L'écran d'InvoiceLead en miniature : en-tête, barre du menu, page, bulle de l'assistant. */}
      <rect x="40" y="10" width="160" height="76" {...S} />
      <path d="M40 22h160M40 32h160" {...S} />
      {[64, 88, 112, 136, 160].map((x) => (
        <path key={x} d={`M${x} 22v10`} {...S} strokeWidth={1.2} opacity={0.5} />
      ))}
      <rect x="186" y="13" width="9" height="6" {...S} strokeWidth={1.2} />
      <rect x="50" y="40" width="64" height="18" {...S} opacity={0.55} />
      <rect x="122" y="40" width="64" height="18" {...S} opacity={0.55} />
      <path d="M50 66h90M50 74h70" {...S} strokeWidth={1.4} opacity={0.55} />
      <circle cx="188" cy="74" r="5" fill="var(--plt-accent)" />
      {/* Le cadre de visée passe du menu à l'en-tête puis à la bulle : là où la visite va aller. */}
      {[
        [42, 23, 110, 31],
        [182, 11, 198, 21],
        [180, 66, 196, 82],
      ].map(([x1 = 0, y1 = 0, x2 = 0, y2 = 0], i) => (
        <path
          key={i}
          className="plt-a-seq"
          style={{ animationDelay: `${i * 1.8}s` }}
          {...A}
          strokeWidth={2.2}
          d={`M${x1} ${y1 + 4}V${y1}h4M${x2 - 4} ${y1}h4v4M${x2} ${y2 - 4}v4h-4M${x1 + 4} ${y2}h-4v-4`}
        />
      ))}
    </g>
  );
}

function Home() {
  return (
    <g>
      {/* Le tableau de bord : deux chiffres qui se remplissent, puis les mois en barres. */}
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(30 ${14 + i * 36})`}>
          <rect width="70" height="30" {...S} />
          <path d="M8 10h24" {...S} strokeWidth={1.4} opacity={0.55} />
          <rect
            x="8"
            y="17"
            width="48"
            height="5"
            fill="var(--plt-accent)"
            className="plt-a-grow"
            style={{ animationDelay: `${i * 0.35}s` }}
          />
        </g>
      ))}
      {[0.4, 0.65, 0.5, 0.8, 0.7, 1].map((h, i) => (
        <rect
          key={i}
          x={118 + i * 16}
          y={20}
          width="10"
          height="60"
          fill="var(--plt-accent)"
          className="plt-a-bar"
          style={{ animationDelay: `${i * 0.12}s`, ["--h" as string]: h }}
        />
      ))}
      <path d="M112 80h102" {...S} />
    </g>
  );
}

function Clock() {
  return (
    <g>
      {/* Le chrono tourne, les heures montent ; le ticket d'une note de frais se pose à côté. */}
      <circle cx="62" cy="48" r="30" {...S} />
      <path d="M62 22v4M62 70v4M36 48h4M84 48h4" {...S} />
      <g className="plt-a-hand" style={{ transformOrigin: "62px 48px" }}>
        <path d="M62 48V28" {...A} strokeWidth={2.2} />
      </g>
      <circle cx="62" cy="48" r="2.5" fill="var(--plt-accent)" />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={110 + i * 20}
          y={24}
          width="11"
          height="56"
          fill="var(--plt-accent)"
          className="plt-a-bar"
          style={{ animationDelay: `${i * 0.2}s`, ["--h" as string]: [0.45, 0.8, 0.6][i] }}
        />
      ))}
      <path d="M104 80h62" {...S} />
      <g className="plt-a-drop" style={{ animationDelay: "0.3s" }}>
        <path d="M178 18h32v58l-4-3-4 3-4-3-4 3-4-3-4 3-4-3-4 3z" {...S} fill="var(--plt-art)" />
        <path d="M184 30h20M184 40h14M184 56h20" {...S} strokeWidth={1.4} opacity={0.55} />
      </g>
    </g>
  );
}

function Quote() {
  return (
    <g>
      {/* Le devis accepté (coche), puis la facture qui se remplit toute seule. */}
      <rect x="40" y="14" width="56" height="68" {...S} />
      <path d="M50 28h28M50 38h36M50 48h22" {...S} strokeWidth={1.4} opacity={0.55} />
      <g className="plt-a-hit">
        <rect x="70" y="58" width="20" height="16" fill="var(--plt-accent)" />
        <path d="M74.5 66l3.5 3 7-6" stroke="var(--plt-on-accent)" strokeWidth={1.8} fill="none" />
      </g>
      <path d="M108 48h20M120 42l8 6-8 6" {...S} opacity={0.6} />
      <rect x="142" y="14" width="56" height="68" {...A} />
      {[28, 38, 48].map((y, i) => (
        <path
          key={y}
          d={`M152 ${y}h36`}
          {...S}
          strokeWidth={1.4}
          className="plt-a-write"
          style={{ animationDelay: `${0.9 + i * 0.25}s` }}
        />
      ))}
      <path
        d="M164 70h24"
        {...A}
        strokeWidth={3}
        className="plt-a-write"
        style={{ animationDelay: "1.8s" }}
      />
    </g>
  );
}

function Invoice() {
  return (
    <g>
      {/* La facture part par e-mail ; les relances suivent, une à une, jusqu'au paiement. */}
      <rect x="30" y="12" width="52" height="72" {...S} />
      <path d="M40 26h26M40 36h32M40 46h20" {...S} strokeWidth={1.4} opacity={0.55} />
      <rect x="40" y="60" width="16" height="16" {...S} strokeWidth={1.4} />
      <rect x="44" y="64" width="8" height="8" fill="var(--plt-ink)" />
      <g className="plt-a-mail">
        <rect x="96" y="34" width="34" height="24" {...A} />
        <path d="M96 34l17 12 17-12" {...A} />
      </g>
      <path d="M150 66h64" {...S} opacity={0.6} />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={154 + i * 22}
          y="58"
          width="12"
          height="16"
          {...S}
          fill="var(--plt-accent)"
          fillOpacity={1}
          className="plt-a-fill"
          style={{ animationDelay: `${0.6 + i * 0.45}s` }}
        />
      ))}
      <g className="plt-a-hit" style={{ animationDelay: "0.4s" }}>
        <rect x="170" y="20" width="30" height="20" fill="var(--plt-accent)" />
        <path d="M178 30l4.5 4 9-8" stroke="var(--plt-on-accent)" strokeWidth={1.8} fill="none" />
      </g>
    </g>
  );
}

function Contacts() {
  return (
    <g>
      {/* Deux fiches (client, fournisseur), puis les articles prêts à facturer : un prix se pose sur la ligne. */}
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${30 + i * 10} ${14 + i * 30})`}>
          <rect width="78" height="36" {...S} fill="var(--plt-art)" />
          <circle cx="16" cy="18" r="7" {...(i ? S : A)} />
          <path d="M30 13h36M30 23h24" {...S} strokeWidth={1.4} opacity={0.55} />
        </g>
      ))}
      {[18, 38, 58].map((y, i) => (
        <g key={y}>
          <path d={`M140 ${y + 6}h40`} {...S} strokeWidth={1.4} opacity={0.55} />
          <rect
            x="190"
            y={y}
            width="20"
            height="12"
            fill="var(--plt-accent)"
            className="plt-a-drop"
            style={{ animationDelay: `${i * 0.35}s` }}
          />
        </g>
      ))}
      <path d="M130 12v68" {...S} opacity={0.3} />
    </g>
  );
}

function Ledger() {
  return (
    <g>
      {/* Une facture et un paiement passent au journal tout seuls : les écritures s'inscrivent ligne à ligne. */}
      <g className="plt-a-mail">
        <rect x="30" y="26" width="34" height="44" {...S} />
        <path d="M38 38h18M38 46h14M38 56h18" {...S} strokeWidth={1.4} opacity={0.55} />
      </g>
      <rect x="120" y="12" width="96" height="72" {...S} />
      <path d="M120 26h96M168 12v72" {...S} strokeWidth={1.4} opacity={0.55} />
      {[36, 50, 64].map((y, i) => (
        <g key={y}>
          <path
            d={`M128 ${y}h${28 - i * 6}`}
            {...S}
            strokeWidth={1.6}
            className="plt-a-write"
            style={{ animationDelay: `${0.8 + i * 0.35}s` }}
          />
          <path
            d={`M176 ${y}h${30 - i * 8}`}
            {...A}
            strokeWidth={1.8}
            className="plt-a-write"
            style={{ animationDelay: `${1 + i * 0.35}s` }}
          />
        </g>
      ))}
      <path d="M78 48h26M96 42l8 6-8 6" {...S} opacity={0.6} />
    </g>
  );
}

function Apps() {
  return (
    <g>
      {/* La famille Lead : le cadre de visée passe d'une application à l'autre, même compte. */}
      {[0, 1, 2].map((c) =>
        [0, 1].map((r) => (
          <rect
            key={`${c}-${r}`}
            x={78 + c * 30}
            y={18 + r * 32}
            width="24"
            height="24"
            {...S}
            fill={c === 1 && r === 1 ? "var(--plt-accent)" : "none"}
            stroke={c === 1 && r === 1 ? "var(--plt-accent)" : "var(--plt-ink)"}
          />
        )),
      )}
      {[
        [78, 18],
        [138, 18],
        [78, 50],
      ].map(([x = 0, y = 0], i) => (
        <path
          key={i}
          className="plt-a-seq"
          style={{ animationDelay: `${i * 1.8}s` }}
          {...A}
          strokeWidth={2.2}
          d={`M${x - 4} ${y + 1}V${y - 4}h5M${x + 23} ${y - 4}h5v5M${x + 28} ${y + 23}v5h-5M${x + 1} ${y + 28}h-5v-5`}
        />
      ))}
    </g>
  );
}

function Toggles() {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(52 ${16 + i * 24})`}>
          <path d="M0 8h84" {...S} strokeWidth={1.4} opacity={0.55} />
          <rect x="104" y="0" width="32" height="16" {...S} />
          <rect
            x="120"
            y="3"
            width="13"
            height="10"
            fill="var(--plt-accent)"
            className="plt-a-switch"
            style={{ animationDelay: `${i * 0.5}s` }}
          />
        </g>
      ))}
    </g>
  );
}

function Chat() {
  return (
    <g>
      <rect
        x="110"
        y="10"
        width="96"
        height="18"
        {...S}
        className="plt-a-pop"
        fill="var(--plt-soft)"
      />
      <g className="plt-a-typing">
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx={44 + i * 9}
            cy="44"
            r="2.6"
            fill="var(--plt-ink)"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </g>
      <g className="plt-a-reply">
        <rect x="34" y="36" width="120" height="44" {...S} />
        <path d="M44 48h76M44 58h56" {...S} strokeWidth={1.4} opacity={0.55} />
        <rect x="118" y="64" width="30" height="11" fill="var(--plt-accent)" />
        <path d="M128 70l3 2.5 6-5" stroke="var(--plt-on-accent)" strokeWidth={1.6} fill="none" />
      </g>
      <rect x="196" y="62" width="24" height="24" fill="var(--plt-accent)" />
      <path d="M202 72h12M202 77h8" stroke="var(--plt-on-accent)" strokeWidth={1.6} />
    </g>
  );
}

function Menu() {
  return (
    <g>
      <rect x="182" y="8" width="16" height="16" {...S} />
      <rect x="120" y="30" width="86" height="58" {...S} />
      <path d="M130 42h44M130 70h36" {...S} strokeWidth={1.4} opacity={0.5} />
      <rect x="121" y="50" width="84" height="13" fill="var(--plt-accent)" className="plt-a-hit" />
      <g className="plt-a-spin" style={{ transformOrigin: "134px 56.5px" }}>
        <path
          d="M138.5 56.5a4.5 4.5 0 1 1-1.3-3.2M138 51v3h-3"
          stroke="var(--plt-on-accent)"
          strokeWidth={1.5}
          fill="none"
        />
      </g>
      <path d="M144 56.5h44" stroke="var(--plt-on-accent)" strokeWidth={1.5} />
      <path d="M40 48h56M86 42l10 6-10 6" {...S} opacity={0.6} />
    </g>
  );
}

const ARTS: Record<ArtName, () => ReactElement> = {
  map: ScreenMap,
  home: Home,
  quote: Quote,
  invoice: Invoice,
  clock: Clock,
  contacts: Contacts,
  ledger: Ledger,
  toggles: Toggles,
  apps: Apps,
  chat: Chat,
  menu: Menu,
};

export function TourArt({ name }: { name: ArtName }) {
  const Art = ARTS[name];
  return (
    <svg viewBox="0 0 240 96" className="plt-art-svg" aria-hidden="true" focusable="false">
      <Art />
    </svg>
  );
}
