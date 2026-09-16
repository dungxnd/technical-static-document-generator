<script lang="ts">
  import type { LucideIcon } from '@lucide/svelte';
  import { Archive, CircleCheck, CircleSlash, Clock, FileCheck } from '@lucide/svelte';

  type DecisionStatus = 'accepted' | 'proposed' | 'deprecated' | 'superseded';

  interface Decision {
    id: string;
    status: DecisionStatus;
    date: string;
    title: string;
    context: string;
    decision: string;
    consequences?: string;
  }

  interface Props {
    records: Decision[];
  }

  let { records }: Props = $props();

  type FilterValue = DecisionStatus | 'all';
  let filter = $state<FilterValue>('all');

  /**
   * Status is carried by an icon AND a label AND a colour — never colour alone,
   * which is what a plain tinted badge would do.
   */
  const statusView: Record<DecisionStatus, { icon: LucideIcon; label: string; tone: string }> = {
    accepted: { icon: CircleCheck, label: 'Accepted', tone: 'success' },
    proposed: { icon: Clock, label: 'Proposed', tone: 'warning' },
    deprecated: { icon: CircleSlash, label: 'Deprecated', tone: 'error' },
    superseded: { icon: Archive, label: 'Superseded', tone: 'neutral' },
  };

  const counts = $derived.by(() => {
    const tally: Record<string, number> = { all: records.length };
    for (const record of records) {
      tally[record.status] = (tally[record.status] ?? 0) + 1;
    }
    return tally;
  });

  const order: FilterValue[] = ['all', 'accepted', 'proposed', 'deprecated', 'superseded'];

  const filters = $derived(
    order.filter((value) => value === 'all' || (counts[value] ?? 0) > 0),
  );

  const visible = $derived(
    filter === 'all' ? records : records.filter((record) => record.status === filter),
  );

  function labelFor(value: FilterValue): string {
    return value === 'all' ? 'All' : (statusView[value]?.label ?? value);
  }
</script>

<section class="adr" aria-labelledby="adr-heading">
  <div class="adr-head">
    <h3 id="adr-heading" class="adr-heading">
      <FileCheck size={15} aria-hidden="true" />
      Architecture decision records
    </h3>

    {#if records.length > 1}
      <div class="adr-filters" role="group" aria-label="Filter by status">
        {#each filters as value (value)}
          <button
            type="button"
            class="adr-filter"
            class:is-active={filter === value}
            aria-pressed={filter === value}
            onclick={() => (filter = value)}
          >
            {labelFor(value)}
            <span class="adr-filter-count">{counts[value] ?? 0}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if visible.length === 0}
    <p class="adr-empty">
      No decision records with status “{labelFor(filter)}”. Choose “All” to see every record.
    </p>
  {:else}
    <ol class="adr-list">
      {#each visible as adr (adr.id)}
        {@const view = statusView[adr.status] ?? statusView.proposed}
        <li class="adr-card" data-tone={view.tone}>
          <div class="adr-card-head">
            <span class="adr-id">{adr.id}</span>
            <h4 class="adr-title">{adr.title}</h4>
            <span class="adr-date">{adr.date}</span>
            <span class="adr-status">
              <view.icon size={12} aria-hidden="true" />
              {view.label}
            </span>
          </div>

          <dl class="adr-body">
            <dt>Context</dt>
            <dd>{adr.context}</dd>
            <dt>Decision</dt>
            <dd>{adr.decision}</dd>
            {#if adr.consequences}
              <dt>Consequences</dt>
              <dd>{adr.consequences}</dd>
            {/if}
          </dl>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .adr {
    margin-block: 1.5rem;
  }

  .adr-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.9rem;
  }

  .adr-heading {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    margin: 0;
  }

  .adr-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .adr-filter {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    background-color: var(--color-base-100);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    cursor: pointer;
    transition:
      border-color 120ms ease-out,
      color 120ms ease-out;
  }
  .adr-filter:hover {
    border-color: var(--color-edge-strong);
    color: var(--color-base-content);
  }
  .adr-filter.is-active {
    border-color: var(--color-primary);
    color: var(--color-base-content);
    font-weight: 600;
    background-color: color-mix(in oklab, var(--color-primary) 10%, var(--color-base-100));
  }

  .adr-filter-count {
    font-family: var(--font-mono);
    opacity: 0.7;
  }

  .adr-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .adr-card {
    --adr-tone: var(--color-neutral);

    padding: 0.9rem 1rem;
    border: 1px solid var(--color-edge);
    border-inline-start: 3px solid var(--adr-tone);
    border-radius: var(--radius-panel);
    background-color: var(--color-base-100);
  }

  .adr-card[data-tone='success'] {
    --adr-tone: var(--color-success);
  }
  .adr-card[data-tone='warning'] {
    --adr-tone: var(--color-warning);
  }
  .adr-card[data-tone='error'] {
    --adr-tone: var(--color-error);
  }
  .adr-card[data-tone='neutral'] {
    --adr-tone: var(--color-neutral);
  }

  .adr-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    margin-bottom: 0.6rem;
    border-bottom: 1px solid var(--color-edge);
  }

  .adr-id {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: 700;
    color: var(--color-primary);
  }

  .adr-title {
    flex: 1;
    min-width: 12ch;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-base-content);
    margin: 0;
  }

  .adr-date {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
  }

  .adr-status {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--adr-tone);
    border: 1px solid color-mix(in oklab, var(--adr-tone) 40%, transparent);
    border-radius: var(--radius-chip);
    padding: 0.05rem 0.35rem;
  }

  .adr-body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.3rem 0.9rem;
    margin: 0;
    font-size: var(--text-meta);
    line-height: 1.6;
  }

  .adr-body dt {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
    padding-top: 0.1rem;
    white-space: nowrap;
  }

  .adr-body dd {
    margin: 0;
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  }

  .adr-empty {
    padding: 1.25rem;
    border: 1px dashed var(--color-edge-strong);
    border-radius: var(--radius-panel);
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
    text-align: center;
  }

  @media (max-width: 560px) {
    .adr-body {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.1rem;
    }
    .adr-body dd {
      margin-bottom: 0.5rem;
    }
  }
</style>
