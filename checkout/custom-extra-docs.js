window.onload = function () {

  (function () {
    'use strict';

    var prefilled = false; // vira true só após uma busca bem-sucedida COM e-mail

    function getOrderForm() {
      return (window.vtexjs && vtexjs.checkout && vtexjs.checkout.orderForm) || null;
    }

    function getEmail(of) {
      return (of && of.clientProfileData && of.clientProfileData.email) || null;
    }

    // ---- Máscara de RG: 00.000.000-0 (até 9 caracteres; o dígito final pode ser X) ----
    function maskRg(value) {
      var chars = value
        .toUpperCase()
        .replace(/[^0-9X]/g, '')
        // X só é válido como dígito verificador (última posição)
        .replace(/X(?=.)/g, '')
        .slice(0, 9);

      return chars
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2}\.\d{3})(\d)/, '$1.$2')
        .replace(/^(\d{2}\.\d{3}\.\d{3})([0-9X])/, '$1-$2');
    }

    // ---- Validação + flags visuais no padrão do checkout (error/success) ----
    function setFlag(el, ok) {
      if (!el) return;
      el.classList.remove('error', 'success');
      el.classList.add(ok ? 'success' : 'error');
    }

    function validateExtraDocs(showFlags) {
      var rgEl = document.getElementById('custom-rg-input');
      var oeEl = document.getElementById('custom-orgao-input');
      if (!rgEl && !oeEl) return true; // campos não renderizados: não bloqueia

      var rgOk = !!rgEl && rgEl.value.trim().length > 0;
      var oeOk = !!oeEl && oeEl.value.trim().length > 0;

      if (showFlags) {
        setFlag(rgEl, rgOk);
        setFlag(oeEl, oeOk);
      }

      return rgOk && oeOk;
    }

    // ---- 1. Cria os campos na tela (idempotente) ----
    function ensureFields() {
      if (document.getElementById('custom-rg-input')) return; // já existe

      var anchor = document.querySelector('fieldset.box-client-info-pf .phone-box')
        || document.querySelector('fieldset.box-client-info-pf');
      if (!anchor) return; // passo de perfil ainda não renderizou

      anchor.insertAdjacentHTML('afterend',
        '<div class="row-fluid custom-extra-docs" style="margin-top:8px">' +
        '<p class="input text pull-left" style="margin-right:10px">' +
        '<label for="custom-orgao-input">Órgão expedidor <span class="required">*</span></label>' +
        '<input type="text" id="custom-orgao-input" class="input-small" ' +
        'autocomplete="off" placeholder="Ex: SSP/SP">' +
        '</p>' +
        '<p class="input text pull-left">' +
        '<label for="custom-rg-input">RG <span class="required">*</span></label>' +
        '<input type="text" id="custom-rg-input" class="input-small" ' +
        'autocomplete="off" maxlength="12" placeholder="Ex: 00.000.000-0">' +
        '</p>' +
        '</div>');
    }

    // ---- 2. Pré-preenche se o cliente já tiver dados salvos ----
    //    Só busca quando JÁ EXISTE e-mail. Enquanto não houver, sai sem
    //    marcar prefilled, para tentar de novo no próximo orderFormUpdated.
    function preencherSeExistir(of) {
      if (prefilled) return;                                   // já resolvido
      if (!document.getElementById('custom-rg-input')) return; // campos ainda não existem

      var email = getEmail(of || getOrderForm());
      if (!email) return;                                      // sem e-mail -> espera próximo update

      fetch('/api/io/safedata/CL/search?_fields=rg,orgaoExpedidor&_limit=1', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'REST-Range': 'resources=0-0' }
      })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          prefilled = true; // tínhamos e-mail e a busca completou: não refaz
          if (rows && rows[0]) {
            var rgEl = document.getElementById('custom-rg-input');
            var oeEl = document.getElementById('custom-orgao-input');
            if (rgEl && rows[0].rg && !rgEl.value) rgEl.value = maskRg(rows[0].rg);
            if (oeEl && rows[0].orgaoExpedidor && !oeEl.value) oeEl.value = rows[0].orgaoExpedidor;
          }
        })
        .catch(function () { /* deslogado/sem dados: ignora e tenta de novo depois */ });
    }

    // ---- 3. Salva na CL via safedata (PATCH, dados no BODY) ----
    function saveExtra() {
      var of = getOrderForm();
      var email = getEmail(of);
      var orderFormId = of && of.orderFormId;
      if (!email || !orderFormId) return;

      var rgEl = document.getElementById('custom-rg-input');
      var oeEl = document.getElementById('custom-orgao-input');
      var rg = ((rgEl && rgEl.value) || '').trim();
      var orgao = ((oeEl && oeEl.value) || '').trim();
      if (!rg && !orgao) return; // nada para salvar

      fetch('/api/io/safedata/CL/documents?_orderFormId=' + encodeURIComponent(orderFormId), {
        method: 'PATCH',                                  // <-- PATCH, nunca GET
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({                            // <-- dados no BODY, não na URL
          email: email,
          rg: rg,
          orgaoExpedidor: orgao
        })
      })
        .then(function (r) {
          return r.text().then(function (t) {
            if (r.ok) {
              console.log('[extra-docs] RG/órgão salvos na CL.');
            } else {
              console.error('[extra-docs] Falha ao salvar:', r.status, t);
            }
          });
        })
        .catch(function (e) { console.error('[extra-docs] Erro de rede:', e); });
    }

    // ---- 4. Reconciliação: cria campos + tenta prefill ----
    //    Chamada no load inicial e a cada atualização do orderForm.
    function refresh(of) {
      ensureFields();
      preencherSeExistir(of);
    }

    // ---- 5. Eventos ----
    function bind() {
      if (window.$) {
        // orderFormUpdated entrega o orderForm já atualizado (2º argumento),
        // inclusive com o clientProfileData.email quando o cliente é identificado.
        $(window).on('orderFormUpdated.vtex', function (evt, orderForm) {
          refresh(orderForm);
        });
        $(document).on('componentValidated.vtex', function () {
          refresh(getOrderForm());
        });
      }

      // Garante o orderForm carregado no PRIMEIRO acesso.
      // getOrderForm() retorna uma promise (jQuery Deferred) e resolve o
      // orderForm completo, evitando ler vtexjs.checkout.orderForm "vazio".
      if (window.vtexjs && vtexjs.checkout && vtexjs.checkout.getOrderForm) {
        vtexjs.checkout.getOrderForm().done(function (orderForm) {
          refresh(orderForm);
        });
      } else {
        refresh(getOrderForm());
      }

      // máscara de RG enquanto digita + limpa o estado de erro ao corrigir
      document.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!t) return;

        if (t.id === 'custom-rg-input') {
          var masked = maskRg(t.value);
          if (t.value !== masked) t.value = masked;
        }

        if ((t.id === 'custom-rg-input' || t.id === 'custom-orgao-input') &&
            t.classList.contains('error') && t.value.trim()) {
          setFlag(t, true);
        }
      }, true);

      // salva ao sair do campo (e atualiza a flag do campo)
      document.addEventListener('blur', function (ev) {
        var t = ev.target;
        if (t && (t.id === 'custom-rg-input' || t.id === 'custom-orgao-input')) {
          setFlag(t, t.value.trim().length > 0);
          saveExtra();
        }
      }, true);

      // RG e órgão expedidor obrigatórios: valida no submit do passo de
      // perfil e só deixa avançar (e salva) se ambos estiverem preenchidos.
      document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;

        var submitBtn = t.closest('.btn.btn-large.btn-success, #go-to-shipping, .btn-go-to-shipping');
        if (!submitBtn) return;
        if (!document.getElementById('custom-rg-input')) return; // campos não estão na tela

        if (!validateExtraDocs(true)) {
          ev.preventDefault();
          ev.stopPropagation();
          var firstInvalid = document.querySelector('#custom-orgao-input.error, #custom-rg-input.error');
          if (firstInvalid) firstInvalid.focus();
          return;
        }

        saveExtra();
      }, true);
    }

    bind();
  })();
};
