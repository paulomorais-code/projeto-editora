// Proteção contra XSS armazenado (análise F-04): dados vindos da API (título, categoria,
// descrição) NUNCA entram em innerHTML sem passar por escapeHtml — nem em texto, nem em atributos.
(function () {
  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );
  }
  window.escapeHtml = escapeHtml;
})();
