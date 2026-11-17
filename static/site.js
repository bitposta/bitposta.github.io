"use strict";

(() => {
  if (!document.getElementById("payment-details")) return;
  const status = document.getElementById("payment-status");
  const qr = document.getElementById("payment-qr");
  const caption = document.getElementById("payment-qr-caption");
  const kinds = ["card", "sheba"];
  const labels = {
    card: "کد تصویری شمارهٔ کارت",
    sheba: "کد تصویری بخش عددی شبا"
  };
  let selected = "card";
  let copyVersion = 0;

  function showQr(kind) {
    selected = kind;
    qr.hidden = true;
    caption.textContent = labels[kind];
    qr.alt = labels[kind];
    qr.src = document.getElementById("payment-show-" + kind).getAttribute("href");
    for (const key of kinds) {
      document.getElementById("payment-show-" + key).setAttribute("aria-pressed", String(key === kind));
    }
    if (qr.complete && qr.naturalWidth > 0) qr.hidden = false;
  }

  qr.addEventListener("load", () => {
    qr.hidden = false;
    caption.textContent = labels[selected];
  });
  qr.addEventListener("error", () => {
    qr.hidden = true;
    caption.textContent = "کد تصویری در دسترس نیست؛ شمارهٔ نوشته‌شده را دستی کپی کنید.";
  });

  for (const kind of kinds) {
    const copy = document.getElementById("payment-copy-" + kind);
    copy.addEventListener("click", async () => {
      const version = ++copyVersion;
      status.textContent = "در حال کپی…";
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(copy.dataset.copy);
        if (version !== copyVersion) return;
        status.textContent = "شماره کپی شد؛ پس از چسباندن، شمارهٔ مقصد و نام صائب ملایی را بررسی کنید.";
        status.dataset.state = "success";
      } catch {
        if (version !== copyVersion) return;
        status.textContent = "کپی خودکار ممکن نشد؛ شماره را انتخاب و دستی کپی کنید.";
        status.dataset.state = "error";
      }
    });
    const control = document.getElementById("payment-show-" + kind);
    control.addEventListener("click", event => {
      event.preventDefault();
      showQr(kind);
    });
    control.addEventListener("keydown", event => {
      if (event.key !== " ") return;
      event.preventDefault();
      showQr(kind);
    });
  }
})();

(() => {
  const form = document.getElementById("lookup-form");
  if (!form) return;
  const field = document.getElementById("serial");
  const addressField = document.getElementById("address");
  const status = document.getElementById("lookup-status");
  const result = document.getElementById("lookup-result");
  const submit = document.getElementById("lookup-submit");
  const balanceSubmit = document.getElementById("balance-submit");
  let currentWallet = null;
  let balancePanel = null;
  // The native form and JS use the server's generator-derived grammar.
  // (?![\\s\\S]) is an absolute end assertion; $ alone permits a final newline.
  const validSerial = new RegExp("^(?:" + (field.getAttribute("pattern") || "(?!)") + ")(?![\\s\\S])");
  const validAddress = new RegExp("^(?:" +
    ((addressField && addressField.getAttribute("pattern")) || "(?!)") + ")(?![\\s\\S])");
  let requestVersion = 0;
  let controller = null;

  function addressValue() {
    return addressField ? addressField.value : "";
  }

  function invalidateLookup() {
    ++requestVersion;
    controller?.abort();
    controller = null;
    currentWallet = null;
    balancePanel = null;
    result.hidden = true;
    result.replaceChildren();
    result.setAttribute("aria-busy", "false");
    submit.disabled = balanceSubmit.disabled = false;
    announce("", "");
  }
  field.addEventListener("input", invalidateLookup);
  if (addressField) addressField.addEventListener("input", invalidateLookup);
  window.addEventListener("pagehide", invalidateLookup);

  function announce(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function limitedMessage(retryAfter) {
    const seconds = typeof retryAfter === 'string' && /^(?:[1-9]|[1-5][0-9]|60)$/.test(retryAfter)
      ? retryAfter.replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]) : null;
    return "برای هر اتصال اینترنتی، پنج استعلام در شصت ثانیه مجاز است؛ " +
      (seconds ? "پس از " + seconds + " ثانیه دوباره تلاش کنید." : "کمی صبر کنید و دوباره بزنید.");
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function validWallet(wallet, serial) {
    return wallet && wallet.serial === serial && typeof wallet.address === 'string' &&
      /^bc1q[a-z0-9]{10,86}$/.test(wallet.address) &&
      wallet.explorer_url === 'https://mempool.space/address/' + wallet.address;
  }

  // The address API keeps its historical three-key body; the page adapts it to
  // the same wallet shape the serial card already renders.
  function addressWallet(body, address) {
    if (!body || typeof body !== "object" || body.address !== address ||
        typeof body.serial !== "string" || !validSerial.test(body.serial) ||
        body.lookup_url !== "https://bitposta.com/s/" + body.serial) {
      return null;
    }
    const wallet = { serial: body.serial, address,
      explorer_url: "https://mempool.space/address/" + address };
    if (body.balance) wallet.balance = body.balance;
    if (body.public) wallet.public = body.public;
    return wallet;
  }

  const PUBLIC_HOSTS = ["bitposta.com", "btc.saeb.id.ir"];
  const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;

  function publicText(value, max) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text || Array.from(text).length > max || UNSAFE.test(text)) return null;
    return text;
  }

  function publicUrl(value) {
    const text = publicText(value, 512);
    if (text === null || !text.startsWith("https://")) return null;
    let url;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== "https:" || !PUBLIC_HOSTS.includes(url.hostname) ||
        url.host !== url.hostname || url.username || url.password ||
        !["", "/"].includes(url.port)) {
      return null;
    }
    return text;
  }

  const LINK_KEY = /^[a-z0-9][a-z0-9._-]{0,31}$/;
  const MAX_LINKS = 20;
  const MAX_LABEL = 32;

  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const PHONE = /^[+0-9][0-9 ().-]*$/;

  function phone(text) {
    if (!PHONE.test(text)) return null;
    const digits = text.replace(/[ ().-]/g, "");
    return digits.length >= 5 ? "tel:" + digits : null;
  }

  // A public link is the seller's own profile page (Instagram, Telegram, ...), so
  // unlike site_url it is not limited to our hosts; only the shape is checked.
  // A bare email or phone (no scheme) becomes mailto:/tel:.
  function linkHref(value) {
    const text = publicText(value, 512);
    if (text === null) return null;
    if (/\s/.test(text) && !text.includes("@") && !PHONE.test(text)) return null;
    const cut = text.indexOf(":");
    const scheme = cut === -1 ? "" : text.slice(0, cut).toLowerCase();
    if (scheme === "mailto") {
      const target = text.slice(cut + 1).trim();
      return EMAIL.test(target) ? "mailto:" + target : null;
    }
    if (scheme === "tel") return phone(text.slice(cut + 1).trim());
    if (text.includes("@") && !text.includes("/")) return EMAIL.test(text) ? "mailto:" + text : null;
    const tel = phone(text);
    if (tel !== null) return tel;
    if (scheme !== "https") return null;
    // Any host is fine for a link (the seller's own profile), but only the shape:
    // https, no userinfo and no explicit port. A host with an underscore (a t.me
    // alias) is accepted on purpose, so no URL() host validation here.
    let url;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== "https:" || !url.host || url.username || url.password ||
        !["", "/"].includes(url.port)) {
      return null;
    }
    return text;
  }

  function publicLinks(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = [];
    const seen = new Set();
    for (const [rawKey, rawUrl] of Object.entries(value)) {
      if (out.length >= MAX_LINKS) break;
      if (typeof rawKey !== "string") continue;
      const label = publicText(rawKey, MAX_LABEL);
      if (label === null || seen.has(label)) continue;
      const href = linkHref(rawUrl);
      if (href !== null) {
        seen.add(label);
        out.push({ key: LINK_KEY.test(label.toLowerCase()) ? label.toLowerCase() : label, href });
      }
    }
    return out.length ? out : null;
  }

  function publicBlock(wallet) {
    const source = wallet.public;
    if (!source || typeof source !== "object") return null;
    const notes = publicText(source.notes, 500);
    let site = null;
    if (source.site && typeof source.site === "object") {
      const key = publicText(source.site.key, 64);
      const href = publicUrl(source.site.url);
      if (key && href && /^[A-Za-z0-9._-]{1,64}$/.test(key)) site = { key, href };
    }
    const image = publicUrl(source.image_url);
    const links = publicLinks(source.links);
    if (notes === null && site === null && image === null && links === null) return null;
    const section = element("section");
    section.setAttribute("aria-label", "اطلاعات اختیاری پاکت");
    if (notes !== null) {
      section.append(element("p", "result-label", "یادداشت عمومی"), element("p", "public-notes", notes));
    }
    if (site !== null) {
      const link = element("a", "ltr-block", site.key);
      link.dir = "ltr";
      link.href = site.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const wrap = element("p");
      wrap.append(link);
      section.append(element("p", "result-label", "سایت"), wrap);
    }
    if (image !== null) {
      const img = element("img");
      img.src = image;
      img.alt = "";
      img.width = 320;
      img.height = 180;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => { img.hidden = true; });
      section.append(element("p", "result-label", "تصویر"), img);
    }
    if (links !== null) {
      const list = element("ul", "public-links");
      for (const { key, href } of links) {
        const link = element("a", "ltr-block", href);
        link.dir = "ltr";
        link.href = href;
        // mailto:/tel: open the phone's own app; a blank tab would be empty.
        if (href.startsWith("https://")) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        const item = element("li");
        item.append(element("span", "public-link-key", key), document.createTextNode(" "), link);
        list.append(item);
      }
      section.append(element("p", "result-label", "شبکه‌های اجتماعی و راه‌های تماس"), list);
    }
    section.append(element("p", "", "این اطلاعات اختیاری را فروشنده نوشته است؛ تأیید موجودی یا اصالت پاکت نیست."));
    return section;
  }

  // Three opt-in explorer links, always derived from the address itself so a
  // server-supplied URL can never redirect the user somewhere else.
  function explorerLinks(address) {
    const explorers = element("div", "explorer-links");
    for (const [prefix, label] of [
      ["https://mempool.space/address/", "کاوشگر مم‌پول ↗"],
      ["https://blockstream.info/address/", "کاوشگر بلاک‌استریم ↗"],
      ["https://www.blockchain.com/explorer/addresses/btc/", "کاوشگر بلاک‌چین ↗"]
    ]) {
      const explorer = element("a", "explorer-link", label);
      explorer.href = prefix + address;
      explorer.target = "_blank";
      explorer.rel = "noopener noreferrer";
      explorers.append(explorer);
    }
    return explorers;
  }

  const balanceUnavailable = "موجودی فعلاً در دسترس نیست؛ این خطا به معنی صفر نیست. آدرس و کد تصویری همچنان قابل استفاده‌اند.";
  const explorerWarning = "هر پیوند، یک سایت خارجی را در زبانهٔ جدید باز می‌کند و آدرس عمومی را با آن سرویس به اشتراک می‌گذارد. مرورگر هیچ درخواست خودکاری به این سرویس‌ها نمی‌فرستد. نمایش آدرس، تضمین موجودی یا تأیید تراکنش نیست.";

  // The balance panel is the first block of the card, so the numbers are visible
  // without scrolling on a phone.
  function showBalance(wallet) {
    const panel = balancePanel;
    if (!panel) return;
    panel.replaceChildren();
    panel.hidden = true;
    const balance = wallet.balance;
    if (!balance && !wallet.balance_error) return;
    panel.hidden = false;
    panel.setAttribute("aria-label", "موجودی آدرس عمومی");
    const valid = balance && balance.address === wallet.address &&
      Number.isSafeInteger(balance.confirmed_sats) && balance.confirmed_sats >= 0 &&
      balance.confirmed_sats <= 2100000000000000 &&
      Number.isSafeInteger(balance.pending_delta_sats) && Math.abs(balance.pending_delta_sats) <= 2100000000000000 &&
      balance.source === 'https://blockstream.info/api' &&
      typeof balance.fetched_at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$/.test(balance.fetched_at) &&
      Number.isFinite(Date.parse(balance.fetched_at));
    if (!valid || wallet.balance_error) {
      wallet.balance_error = 'unavailable';
      panel.append(element("p", "lookup-status", balanceUnavailable));
    } else {
      panel.append(element("h2", "", "موجودی آدرس عمومی"));
      for (const [label, amount, signed] of [
        ["موجودی تأییدشده", balance.confirmed_sats, false],
        ["تغییر خالص در انتظار", balance.pending_delta_sats, true]
      ]) {
        const magnitude = BigInt(Math.abs(amount));
        const sign = amount < 0 ? '-' : signed && amount > 0 ? '+' : '';
        const sats = element("p", "balance-value ltr-block", sign + magnitude);
        const btc = element("p", "balance-value ltr-block", sign + magnitude / 100000000n + '.' +
          (magnitude % 100000000n).toString().padStart(8, '0'));
        sats.dir = btc.dir = "ltr";
        panel.append(element("h3", "", label), element("p", "", "ساتوشی"), sats,
          element("p", "", "بیت‌کوین"), btc);
      }
      const source = element("p", "ltr-block", balance.source);
      const fetched = element("p", "ltr-block", balance.fetched_at);
      source.dir = fetched.dir = "ltr";
      panel.append(element("p", "", "منبع"), source,
        element("p", "", "زمان شروع دریافت به وقت جهانی؛ زمان ثبت در شبکه نیست."), fetched,
        element("p", "", "تغییر در انتظار قطعی نیست؛ می‌تواند منفی، حذف یا جایگزین شود. این اعداد تضمین موجودی قابل خرج یا اصالت پاکت نیستند. تاریخچه دریافت نمی‌شود."));
    }
  }

  // Bring the freshly rendered card to the top of the viewport so the balance
  // block is on screen without the user hunting for it. This is a direct
  // response to a click, never an automatic request.
  function revealResult() {
    if (typeof result.scrollIntoView === "function") {
      result.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  function showWallet(wallet) {
    if (currentWallet?.serial === wallet.serial && currentWallet.address === wallet.address && !result.hidden) {
      currentWallet = wallet;
      showBalance(wallet);
      return;
    }
    currentWallet = wallet;
    const heading = element("h2", "", "آدرس عمومی این پاکت");
    const balanceSlot = element("section", "balance-panel");
    balanceSlot.hidden = true;
    const addressLabel = element("p", "result-label", "آدرس دریافت در شبکهٔ اصلی بیت‌کوین");
    const address = element("p", "public-address ltr-block", wallet.address);
    address.dir = "ltr";
    const copy = element("button", "secondary-button", "کپی آدرس عمومی");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(wallet.address);
        announce("آدرس عمومی کپی شد. پس از چسباندن، آدرس کامل مقصد را دوباره بررسی کنید.", "success");
      } catch {
        announce("کپی خودکار ممکن نشد. آدرس عمومی را از کادر بالا انتخاب و دستی کپی کنید.", "error");
      }
    });
    const serialLabel = element("p", "result-label", "شمارهٔ سریال");
    const serial = element("p", "public-serial ltr-block", wallet.serial);
    serial.dir = "ltr";
    const figure = element("figure", "qr-block");
    const qr = element("img");
    qr.src = "/api/wallets/" + encodeURIComponent(wallet.serial) + "/qr.svg";
    qr.alt = "کد تصویری آدرس عمومی برای دریافت بیت‌کوین";
    qr.width = 192;
    qr.height = 192;
    const caption = element("figcaption", "", "فقط برای دریافت؛ کلمات بازیابی در این تصویر نیست.");
    qr.addEventListener("error", () => {
      qr.hidden = true;
      caption.textContent = "کد تصویری فعلاً در دسترس نیست؛ از آدرس عمومی نوشته‌شده استفاده کنید.";
    });
    figure.append(qr, caption);
    const warning = element("p", "result-warning", explorerWarning);
    const nodes = [heading, balanceSlot, addressLabel, address, copy, serialLabel, serial, figure];
    const optional = publicBlock(wallet);
    if (optional !== null) nodes.push(optional);
    nodes.push(explorerLinks(wallet.address), warning);
    result.replaceChildren(...nodes);
    result.hidden = false;
    balancePanel = balanceSlot;
    showBalance(wallet);
    revealResult();
  }

  // A valid address that is simply not ours is not a dead end: the user still
  // gets the three explorer links, and we never ask a third party for a balance.
  function showAddressNotFound(address) {
    currentWallet = null;
    balancePanel = null;
    const heading = element("h2", "", "این آدرس در فهرست ما ثبت نشده است");
    const message = element("p", "", "این آدرس عمومی در فهرست پاکت‌های ما نیست. اگر پاکت را از ما نخریده‌اید یا آدرس را خودتان ساخته‌اید، این طبیعی است. موجودی را برای این آدرس از سرویس بیرونی نمی‌گیریم.");
    const addressLabel = element("p", "result-label", "آدرس عمومی");
    const addressNode = element("p", "public-address ltr-block", address);
    addressNode.dir = "ltr";
    result.replaceChildren(heading, message, addressLabel, addressNode,
      explorerLinks(address), element("p", "result-warning", explorerWarning));
    result.hidden = false;
    revealResult();
  }

  const notRegisteredMessage = "این آدرس در فهرست ما ثبت نشده است. سه پیوند کاوشگر برای بررسی خودتان نمایش داده شد؛ موجودی را ما نمی‌گیریم.";

  function currentQuery() {
    // Never normalize: a leading or trailing space is a different token and the
    // server would reject it anyway.
    const serial = field.value;
    if (serial) return { mode: "serial", value: serial };
    const address = addressValue();
    if (address) return { mode: "address", value: address };
    return { mode: "serial", value: "" };
  }

  async function lookup(withBalance = false) {
    const version = ++requestVersion;
    controller?.abort();
    controller = new AbortController();
    balanceSubmit.disabled = false;
    result.setAttribute("aria-busy", "false");
    submit.disabled = false;
    const { mode, value } = currentQuery();
    const retained = withBalance && currentWallet && !result.hidden &&
      (mode === "serial" ? currentWallet.serial === value : currentWallet.address === value)
      ? { serial: currentWallet.serial, address: currentWallet.address,
          explorer_url: currentWallet.explorer_url }
      : null;
    if (retained) showWallet(retained);
    else {
      currentWallet = null;
      balancePanel = null;
      result.hidden = true;
      result.replaceChildren();
    }
    if (!value) {
      announce("شمارهٔ سریال یا آدرس عمومی را وارد کنید.", "error");
      field.focus();
      return;
    }
    if (mode === "serial") {
      if (!validSerial.test(value)) {
        field.setAttribute("aria-invalid", "true");
        announce("شمارهٔ سریال معتبر نیست. فقط حروف و ارقام انگلیسی، خط تیره یا زیرخط وارد کنید؛ آغاز آن باید حرف یا رقم باشد.", "error");
        field.focus();
        return;
      }
      field.removeAttribute("aria-invalid");
    } else {
      if (!validAddress.test(value)) {
        if (addressField) addressField.setAttribute("aria-invalid", "true");
        announce("آدرس عمومی معتبر نیست. آدرسی که با bc1q شروع می‌شود و ۴۲ نویسه دارد را کامل و بدون فاصله وارد کنید.", "error");
        if (addressField) addressField.focus();
        return;
      }
      if (addressField) addressField.removeAttribute("aria-invalid");
    }
    result.setAttribute("aria-busy", "true");
    submit.disabled = true;
    balanceSubmit.disabled = true;
    announce(withBalance ? "در حال دریافت موجودی…" : "در حال پیدا کردن آدرس عمومی…", "loading");
    const path = mode === "serial" ? "/api/wallets/" : "/api/addresses/";
    try {
      const response = await fetch(path + encodeURIComponent(value) + (withBalance ? "?balance=1" : ""), {
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (version !== requestVersion) return;
      if (response.status === 429) {
        announce(limitedMessage(response.headers?.get("Retry-After")), "error");
        return;
      }
      if (response.status === 404) {
        currentWallet = null;
        balancePanel = null;
        if (mode === "address") {
          showAddressNotFound(value);
          announce(notRegisteredMessage, "notice");
        } else {
          result.replaceChildren();
          result.hidden = true;
          announce("پاکتی با این شمارهٔ سریال پیدا نشد. حروف و ارقام را دوباره با روی پاکت تطبیق دهید.", "error");
        }
        return;
      }
      if (response.status === 400) {
        if (mode === "address") {
          if (addressField) addressField.setAttribute("aria-invalid", "true");
          announce("آدرس عمومی معتبر نیست. آن را دقیقاً از روی پاکت یا کیف پول کپی کنید.", "error");
        } else {
          field.setAttribute("aria-invalid", "true");
          announce("شمارهٔ سریال معتبر نیست. آن را دقیقاً مطابق روی پاکت وارد کنید.", "error");
        }
        return;
      }
      if (!response.ok && !(withBalance && response.status === 503)) throw new Error("Lookup unavailable");
      const body = await response.json();
      if (version !== requestVersion) return;
      const wallet = mode === "serial"
        ? (validWallet(body, value) ? body : null)
        : addressWallet(body, value);
      if (!wallet) {
        throw new Error("Unexpected public wallet response");
      }
      if (withBalance && !wallet.balance) wallet.balance_error = 'unavailable';
      showWallet(wallet);
      announce(withBalance ? (wallet.balance_error ? balanceUnavailable : "نتیجهٔ موجودی دریافت شد؛ زمان و محدودیت‌های زیر را بخوانید.") :
        "آدرس عمومی پیدا شد. پیش از واریز، آدرس کامل و شبکه را بررسی کنید.", wallet.balance_error ? "error" : "success");
    } catch {
      if (version !== requestVersion) return;
      if (retained) showWallet({...retained, balance_error: 'unavailable'});
      announce(withBalance ? balanceUnavailable : "سرویس استعلام فعلاً در دسترس نیست. کمی بعد دوباره تلاش کنید؛ کلمات بازیابی را ارسال نکنید.", "error");
    } finally {
      if (version === requestVersion) {
        result.setAttribute("aria-busy", "false");
        submit.disabled = false;
        balanceSubmit.disabled = false;
      }
    }
  }

  field.addEventListener("invalid", (event) => {
    event.preventDefault();
    return lookup();
  });
  if (addressField) {
    addressField.addEventListener("invalid", (event) => {
      event.preventDefault();
      return lookup();
    });
  }

  form.addEventListener("submit", (event) => {
    // Ordinary API lookup intentionally omits public metadata; submit natively.
    if (event.submitter !== balanceSubmit) return;
    event.preventDefault();
    return lookup(true);
  });

  const initialState = form.dataset.initialState;
  if (form.dataset.initialSerial || initialState) {
    const serial = form.dataset.initialSerial;
    const wallet = { serial, address: form.dataset.initialAddress, explorer_url: form.dataset.initialExplorer };
    if (initialState === 'found' && validSerial.test(serial) && validWallet(wallet, serial)) {
      try { wallet.public = JSON.parse(form.dataset.initialPublic || 'null'); }
      catch { wallet.public = null; }
      try { wallet.balance = JSON.parse(form.dataset.initialBalance || 'null'); }
      catch { wallet.balance_error = 'unavailable'; }
      if (form.dataset.balanceError) wallet.balance_error = 'unavailable';
      showWallet(wallet);
      announce(wallet.balance_error ? balanceUnavailable : "آدرس عمومی پیدا شد. پیش از واریز، آدرس کامل و شبکه را بررسی کنید.", wallet.balance_error ? "error" : "success");
    } else if (initialState === 'address_not_found') {
      const address = addressValue();
      if (validAddress.test(address)) {
        showAddressNotFound(address);
        announce(notRegisteredMessage, "notice");
      }
    } else if (initialState === 'rate_limited') {
      announce(limitedMessage(form.dataset.retryAfter), "error");
    } else if (initialState === 'not_found') {
      announce("پاکتی با این شمارهٔ سریال پیدا نشد. حروف و ارقام را دوباره با روی پاکت تطبیق دهید.", "error");
    } else if (initialState === 'invalid_address') {
      announce("آدرس عمومی معتبر نیست. آن را دقیقاً از روی پاکت یا کیف پول کپی کنید.", "error");
    } else if (initialState) {
      announce("سرویس استعلام فعلاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.", "error");
    } else {
      lookup();
    }
  }
})();
