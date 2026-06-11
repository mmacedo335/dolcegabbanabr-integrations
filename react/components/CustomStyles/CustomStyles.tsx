import { useEffect } from "react";

import styles from "./CustomStyles.css";

const RG_INPUT_ID = "custom-rg-input";
const ORGAO_INPUT_ID = "custom-orgao-input";
const WRAPPER_ID = "custom-extra-docs";

// Máscara de RG: 00.000.000-0 (até 9 caracteres; o dígito final pode ser X)
function maskRg(value: string) {
  const chars = value
    .toUpperCase()
    .replace(/[^0-9X]/g, "")
    // X só é válido como dígito verificador (última posição)
    .replace(/X(?=.)/g, "")
    .slice(0, 9);

  return chars
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2}\.\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{2}\.\d{3}\.\d{3})([0-9X])/, "$1-$2");
}

// Busca rg/orgaoExpedidor do cadastro (CL) do usuário logado.
// O safedata devolve apenas os dados do próprio usuário (escopo do cookie).
let extraDocsPromise: Promise<{
  rg?: string;
  orgaoExpedidor?: string;
} | null> | null = null;

function fetchExtraDocs() {
  if (!extraDocsPromise) {
    extraDocsPromise = fetch(
      "/api/io/safedata/CL/search?_fields=rg,orgaoExpedidor&_limit=1",
      {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "REST-Range": "resources=0-0",
        },
      }
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => (rows && rows[0]) || null)
      .catch(() => {
        extraDocsPromise = null; // permite nova tentativa no próximo render
        return null;
      });
  }

  return extraDocsPromise;
}

// Salva na CL via safedata. Fora do checkout não há vtexjs, então o
// orderFormId e o e-mail (exigidos pelo PATCH) vêm da API de orderForm,
// que já retorna o perfil preenchido para usuário logado.
async function saveExtraDocs() {
  const rgEl = document.getElementById(RG_INPUT_ID) as HTMLInputElement | null;
  const oeEl = document.getElementById(
    ORGAO_INPUT_ID
  ) as HTMLInputElement | null;
  const rg = ((rgEl && rgEl.value) || "").trim();
  const orgao = ((oeEl && oeEl.value) || "").trim();

  if (!rg && !orgao) return;

  try {
    const of = await fetch("/api/checkout/pub/orderForm", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    }).then((r) => (r.ok ? r.json() : null));

    const orderFormId = of && of.orderFormId;
    let email: string | undefined =
      of && of.clientProfileData && of.clientProfileData.email;

    // e-mail pode vir mascarado; usa o do login como fallback
    if (!email || email.includes("*")) {
      const user = await fetch("/api/vtexid/pub/authenticated/user", {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      email = user && user.user;
    }

    if (!orderFormId || !email) return;

    const res = await fetch(
      `/api/io/safedata/CL/documents?_orderFormId=${encodeURIComponent(
        orderFormId
      )}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, rg, orgaoExpedidor: orgao }),
      }
    );

    if (res.ok) {
      console.log("[extra-docs] RG/órgão salvos na CL.");
    } else {
      console.error("[extra-docs] Falha ao salvar:", res.status, await res.text());
    }
  } catch (e) {
    console.error("[extra-docs] Erro de rede:", e);
  }
}

// Cria os campos logo após o bloco da data de nascimento (idempotente)
// e pré-preenche com o que existir no cadastro.
function ensureExtraDocsFields(anchor: Element) {
  if (document.getElementById(WRAPPER_ID)) return;

  anchor.insertAdjacentHTML(
    "afterend",
    `<div id="${WRAPPER_ID}" class="${styles.extraDocsWrapper}">` +
      `<label class="${styles.extraDocsLabel}">RG` +
      `<input type="text" id="${RG_INPUT_ID}" class="${styles.extraDocsInput}" autocomplete="off" maxlength="12" placeholder="Ex: 00.000.000-0">` +
      `</label>` +
      `<label class="${styles.extraDocsLabel}">Órgão expedidor` +
      `<input type="text" id="${ORGAO_INPUT_ID}" class="${styles.extraDocsInput}" autocomplete="off" placeholder="Ex: SSP/SP">` +
      `</label>` +
      `</div>`
  );

  fetchExtraDocs().then((doc) => {
    if (!doc) return;

    const rgEl = document.getElementById(
      RG_INPUT_ID
    ) as HTMLInputElement | null;
    const oeEl = document.getElementById(
      ORGAO_INPUT_ID
    ) as HTMLInputElement | null;

    if (rgEl && doc.rg && !rgEl.value) rgEl.value = maskRg(doc.rg);
    if (oeEl && doc.orgaoExpedidor && !oeEl.value)
      oeEl.value = doc.orgaoExpedidor;
  });
}

const CustomStyles = () => {
  // acha o bloco da data de nascimento e injeta os campos extras (RG/órgão)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!window.location.href.includes("/profile")) return;
      const birthDateBox = document.querySelector(
        ".vtex-my-account-1-x-profileForm-birthDate"
      );

      if (birthDateBox) {
        ensureExtraDocsFields(birthDateBox);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // aplica a máscara de RG enquanto digita
    const onInput = (ev: Event) => {
      const target = ev.target as HTMLInputElement | null;

      if (target && target.id === RG_INPUT_ID) {
        const masked = maskRg(target.value);

        if (target.value !== masked) target.value = masked;
      }
    };

    // salva ao sair dos campos (mesmo comportamento do script do checkout)
    const onBlur = (ev: FocusEvent) => {
      const target = ev.target as HTMLElement | null;

      if (
        target &&
        (target.id === RG_INPUT_ID || target.id === ORGAO_INPUT_ID)
      ) {
        saveExtraDocs();
      }
    };

    // salva também quando o formulário de perfil é submetido
    const onClick = (ev: MouseEvent) => {
      if (!window.location.href.includes("/profile")) return;
      const target = ev.target as HTMLElement | null;

      if (
        target &&
        target.closest &&
        target.closest('button[type="submit"]') &&
        document.getElementById(WRAPPER_ID)
      ) {
        saveExtraDocs();
      }
    };

    document.addEventListener("input", onInput, true);
    document.addEventListener("blur", onBlur, true);
    document.addEventListener("click", onClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
};

export default CustomStyles;
