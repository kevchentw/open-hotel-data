import "./styles.css";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">Open Hotel Data</p>
      <h1>Static hotel metadata and price explorer</h1>
      <p class="lede">
        This repo is scaffolded for GitHub Pages with one-row-per-hotel CSV metadata
        and per-hotel price history files.
      </p>
    </section>
    <section class="card">
      <h2>Scaffold Ready</h2>
      <p>
        Next steps are to implement the source collectors under <code>data-pipeline/1-list/scripts/</code>,
        wire the merge logic, and build out the list/detail UI.
      </p>
    </section>
  </main>
`;
