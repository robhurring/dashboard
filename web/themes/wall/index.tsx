import "./tokens.css";
import { Column, Page, Pages, Row, Slot } from "../../src/layout";

/** One layout that scales with the viewport (the root font size tracks it). Each <Slot> declares its instance to the server while on screen. */
export default function Wall() {
  return (
    <Pages home="tasks" returnHomeAfter="5m">
      <Page id="tasks" title="Tasks">
        <Slot module="todoist" project="inbox" />
      </Page>
      <Page id="glance" title="Glance">
        <Column>
          <Row>
            <Slot module="clock" instance="home" tz="America/New_York" label="New York" date="dddd, MMMM D" chrome="minimal" />
            <Slot module="slack" chrome="full" />
            <Slot module="weather" instance="home" zip="07110" title="Home · {{state.place}}" chrome="full" />
          </Row>
          <Row>
            <Slot module="stocks" title="Markets" poll="always" />
            <Slot module="calendar" days={3} chrome="full" size={2} />
          </Row>
        </Column>
      </Page>
      <Page id="news" title="News">
        <Row>
          <Column>
            <Slot module="ainews" chrome="full" />
            <Slot module="news" instance="technology" topic="technology" size="40%" chrome="full" />
          </Column>
          <Column>
            <Slot module="news" instance="ai" topic="ai" chrome="full" />
            <Slot module="news" instance="openai" topic="openai" chrome="full" />
          </Column>
          <Column>
            <Slot module="news" instance="anthropic" topic="anthropic" chrome="full" />
            <Slot module="news" instance="salesforce" topic="salesforce" chrome="full" />
          </Column>
        </Row>
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
