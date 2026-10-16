import "./tokens.css";
import { Column, Page, Pages, Row, Slot } from "@dashboard/layout";

/**
 * The default theme: the standard modules on two pages. Copy it into local/themes/<name> to make your
 * own, and set DEFAULT_THEME=<name> to open with it.
 */
export default function Home() {
  return (
    <Pages home="glance" returnHomeAfter="5m">
      <Page id="glance" title="Glance">
        <Column>
          <Row>
            <Slot module="clock" instance="home" tz="America/New_York" label="New York" date="dddd, MMMM D" chrome="minimal" />
            <Slot module="weather" instance="home" zip="10001" title="Weather · {{state.place}}" chrome="full" size={2} />
          </Row>
          <Row>
            <Slot module="stocks" title="Markets" />
            <Slot module="calendar" days={3} chrome="full" size={2} />
          </Row>
        </Column>
      </Page>
      <Page id="status" title="Status">
        <Column>
          <Row>
            <Slot module="system" instance="cpu" show="cpu" title="CPU" icon="cpu" size="large" />
            <Slot module="system" instance="memory" show="memory" title="Memory" icon="memory-stick" size="large" />
            <Slot module="redis" instance="memory" show="memory" title="Redis" size="large" />
          </Row>
          <Row>
            <Slot module="system" instance="history" show="history" title="CPU · last hour" icon="activity" size="large" />
          </Row>
        </Column>
      </Page>
    </Pages>
  );
}
