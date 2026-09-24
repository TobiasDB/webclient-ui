import type { Meta, StoryObj } from "@storybook/react-vite";
import { Frame, Box, Row, Col, Lines } from "./Wire";

/** LOW-FI WIREFRAMES for the product website (docs/product/website-user-stories.md). */
const meta: Meta = { title: "Wireframes/Website", parameters: { layout: "fullscreen" } };
export default meta;

const Nav = () => <Box tone="nav" label="WebClient   Why · Features · Docs · Cost · Playground · Lab   [GitHub]" />;

export const Home: StoryObj = {
  render: () => (
    <Frame title="Home" height={1400}>
      <Col rows="36px auto auto auto auto auto">
        <Nav />
        <Row cols="1fr 1fr">
          <Box tone="primary" label="HERO: one sentence + the 8-line snippet (copy) + 'rows in 30 s'" note="A1: the snippet runs against THIS site; the result beside it is live (cached ≤60 s), not a screenshot"><Lines n={8} /></Box>
          <Box label="THE ONE IDEA (diagram)" note="A2: plan → sync / async / remote / lazy; three outcomes: cheaper · deterministic · auditable"><Lines n={6} /></Box>
        </Row>
        <Box label="LIVE PROOF STRIP (A3)" note="three of this site's pages: static (42 ms) · changelog → auto-escalated to browser (spa 84%) · feed → its API; the flags that decided it, with evidence on hover" />
        <Row cols="1fr 1fr 1fr">
          <Box label="EVALUATE →" note="why not Playwright / a Claude session / a SaaS — runnable" />
          <Box label="BUILD →" note="the tools, MCP in one line, typed errors with remedies, the Playground" />
          <Box label="OPERATE →" note="self-hosted, the container, k8s, traces, /health" />
        </Row>
        <Row cols="1fr 1fr">
          <Box label="COST (F1)" note="tokens per page (skeleton vs HTML vs markdown) · $ per authored query · $0 per re-run · calculator" />
          <Box label="CASE STUDY (A5)" note="onboarding the case-studies listing: before / after, the replay link" />
        </Row>
        <Box tone="muted" label="footer: docs · changelog (RSS) · lab · github · 'self-hosted; your data never leaves' (F3)" />
      </Col>
    </Frame>
  ),
};

export const Why: StoryObj = {
  render: () => (
    <Frame title="/why" height={1100}>
      <Col rows="36px auto auto auto">
        <Nav />
        <Box tone="primary" label="Playwright vs WebClient — the same three tasks, side by side, both runnable (B1)" note="task tabs: extract a listing · a JS page · pagination">
          <Row cols="1fr 1fr"><Box label="the script (imperative)"><Lines n={9} /></Box><Box label="the plan (data) + wireframe + identical rows"><Lines n={9} /></Box></Row>
        </Box>
        <Box label="A Claude session per run vs author once (B2)" note="the determinism/cost table + a live re-run counter: the same blob 3× → identical rows, $0" />
        <Row cols="1fr 1fr"><Box label="vs a scraping SaaS — honest (B3)" /><Box label="what it does NOT do (B4)" /></Row>
      </Col>
    </Frame>
  ),
};

export const FeaturePage: StoryObj = {
  name: "Feature page (template)",
  render: () => (
    <Frame title="/features/<x>" height={900}>
      <Col rows="36px auto 1fr auto">
        <Nav />
        <Box tone="primary" label="THE CLAIM in one line" note="e.g. 'The cheapest transport that works — a browser only when the page needs one.'" />
        <Row cols="1fr 1fr">
          <Box label="LIVE DEMO — input" note="a page of this site (dropdown) · the option (tier) · Run; 'last run 12 s ago · 0.4 s'"><Lines n={6} /></Box>
          <Box label="LIVE DEMO — output" note="the shared components read-only: tier ladder · flags · rows · wireframe · trace timeline"><Lines n={6} /></Box>
        </Row>
        <Row cols="1fr 1fr 1fr">
          <Box label="the code that produced it (python · http · mcp)" />
          <Box label="token-efficiency evidence inline (F2)" note="skeleton 1.9 KB vs HTML 41 KB" />
          <Box label="what to read next · try it in the Playground" />
        </Row>
      </Col>
    </Frame>
  ),
};

export const OnboardingReplay: StoryObj = {
  name: "/features/onboarding — a REPLAY (C5)",
  render: () => (
    <Frame title="/features/onboarding" height={900}>
      <Col rows="36px auto auto 1fr auto">
        <Nav />
        <Box tone="primary" label="Author once, run forever — watch a recorded run (demo model, badged), then re-run its blob live with no model" />
        <Box label="STAGE RAIL driven by the scrubber" note="search → crawl → select → evaluate → confirm → source → query" />
        <Row cols="1fr 1fr">
          <Box label="THE TRACE (scrubber + lanes)" note="the same timeline component as the Playground, read-only"><Lines n={8} /></Box>
          <Box label="AT THIS MOMENT" note="the stage's artefact: candidates / the confirm decision / the query + sample rows"><Lines n={8} /></Box>
        </Row>
        <Row cols="1fr 1fr"><Box tone="primary" label="RE-RUN THE BLOB NOW → identical rows, $0 (counter)" /><Box label="TRY IT ON YOUR DATA → the Playground's Onboard, brief pre-filled, stub selected (5.6)" /></Row>
      </Col>
    </Frame>
  ),
};

export const Cost: StoryObj = {
  render: () => (
    <Frame title="/cost" height={900}>
      <Col rows="36px auto auto auto">
        <Nav />
        <Box tone="primary" label="What an extraction costs — measured by CI against this site, dated, with the model named (F1)" />
        <Row cols="1fr 1fr 1fr">
          <Box label="TOKENS PER PAGE" note="raw HTML · markdown · skeleton · card — bars per page kind"><Lines n={5} /></Box>
          <Box label="$ PER AUTHORED QUERY" note="the onboarding run's spend (tokens × price)" />
          <Box label="$ PER RE-RUN" note="0 — the blob runs with no model" />
        </Row>
        <Row cols="1fr 1fr">
          <Box label="CALCULATOR" note="pages/day · re-runs/day → per-run session cost vs author-once; self-hosting: pages per pod" />
          <Box label="METHOD" note="the script, the brief, the model, the date; reproducible" />
        </Row>
      </Col>
    </Frame>
  ),
};
