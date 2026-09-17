(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const accountType = params.get("type") === "studio" ? "studio" : "listener";
  const resetToken = params.get("token") || "";
  const requestPanel = document.querySelector("#request-panel");
  const confirmPanel = document.querySelector("#confirm-panel");
  const requestForm = document.querySelector("#request-form");
  const confirmForm = document.querySelector("#confirm-form");
  const requestEmail = document.querySelector("#request-email");
  const requestEmailLabel = document.querySelector("#request-email-label");
  const requestExplanation = document.querySelector("#request-explanation");
  const requestButton = document.querySelector("#request-button");
  const confirmButton = document.querySelector("#confirm-button");
  const requestStatus = document.querySelector("#request-status");
  const confirmStatus = document.querySelector("#confirm-status");
  const backLink = document.querySelector("#back-link");
  let formToken = "";

  configurePage();
  void initialiseSecurity();

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(requestStatus, "", false);
    if (!formToken) {
      setStatus(requestStatus, "La vérification de sécurité est indisponible. Rechargez la page.", true);
      return;
    }
    if (accountType === "listener" && !requestForm.reportValidity()) return;

    requestButton.disabled = true;
    try {
      const result = await postJson("/api/password-reset/request", {
        accountType,
        email: accountType === "listener" ? requestEmail.value.trim() : "",
        formToken,
      });
      requestForm.hidden = true;
      setStatus(requestStatus, result.message || "Consultez votre boîte e-mail.", false);
    } catch (error) {
      setStatus(requestStatus, error.message || "Impossible d’envoyer le lien pour le moment.", true);
    } finally {
      requestButton.disabled = false;
    }
  });

  confirmForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(confirmStatus, "", false);
    if (!formToken) {
      setStatus(confirmStatus, "La vérification de sécurité est indisponible. Rechargez la page.", true);
      return;
    }
    if (!confirmForm.reportValidity()) return;

    const password = document.querySelector("#new-password").value;
    const confirmation = document.querySelector("#confirm-password").value;
    if (password !== confirmation) {
      setStatus(confirmStatus, "Les deux mots de passe ne correspondent pas.", true);
      return;
    }

    confirmButton.disabled = true;
    try {
      const result = await postJson("/api/password-reset/confirm", {
        accountType,
        token: resetToken,
        password,
        confirmation,
        formToken,
      });
      confirmForm.reset();
      confirmForm.hidden = true;
      setStatus(confirmStatus, result.message || "Votre mot de passe a été modifié.", false);
      backLink.textContent = accountType === "studio"
        ? "Se connecter au Studio"
        : "Se connecter à votre compte";
    } catch (error) {
      setStatus(confirmStatus, error.message || "Ce lien ne peut pas être utilisé.", true);
    } finally {
      confirmButton.disabled = false;
    }
  });

  function configurePage() {
    if (accountType === "studio") {
      document.querySelector("#reset-title").textContent = "Mot de passe Studio oublié";
      document.querySelector("#reset-intro").textContent =
        "Un lien sécurisé sera envoyé à l’adresse de récupération de l’équipe.";
      requestExplanation.textContent =
        "Pour protéger l’espace Studio, l’adresse de récupération n’est pas affichée ici.";
      requestEmail.hidden = true;
      requestEmail.required = false;
      requestEmailLabel.hidden = true;
      backLink.href = "/studio";
    }

    if (resetToken) {
      requestPanel.hidden = true;
      confirmPanel.hidden = false;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = "";
      cleanUrl.searchParams.set("type", accountType);
      window.history.replaceState(null, "", cleanUrl.pathname + cleanUrl.search);
    }
  }

  async function initialiseSecurity() {
    try {
      const response = await fetch("/api/config", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.formToken) {
        throw new Error(result.error || "Configuration indisponible.");
      }
      formToken = result.formToken;
    } catch (error) {
      const target = resetToken ? confirmStatus : requestStatus;
      setStatus(target, "La connexion sécurisée est indisponible. Réessayez dans un instant.", true);
    }
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Une erreur temporaire est survenue.");
    }
    return result;
  }

  function setStatus(element, message, isError) {
    element.textContent = message;
    element.className = isError ? "form-status is-error" : "form-status is-success";
  }
})();
