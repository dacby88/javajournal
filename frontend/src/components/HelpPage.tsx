import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowUp, BookOpen, ChevronRight, Search, X } from 'lucide-react';
import { helpSections, filterHelpSections } from '@/lib/helpGuide';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const totalTopics = helpSections.reduce((total, section) => total + section.topics.length, 0);

export function HelpPage() {
  const location = useLocation();
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const sections = useMemo(() => filterHelpSections(search), [search]);
  const topicIds = sections.flatMap(section => section.topics.map(topic => topic.id));
  const [expandedTopics, setExpandedTopics] = useState<string[]>(() => {
    if (search.trim()) return filterHelpSections(search).flatMap(section => section.topics.map(topic => topic.id));
    const section = helpSections.find(item => item.id === location.hash.slice(1));
    return section ? section.topics.map(topic => topic.id) : ['first-session'];
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'User Help Guide | Java Journal';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);

  const updateSearch = (value: string) => {
    setSearch(value);
    setExpandedTopics(value.trim()
      ? filterHelpSections(value).flatMap(section => section.topics.map(topic => topic.id))
      : ['first-session']);
  };

  const clearSearch = () => {
    updateSearch('');
    document.getElementById('help-search')?.focus();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex min-h-16 items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="truncate text-base font-semibold sm:text-lg">User Help Guide</span>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Dashboard
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 sm:py-8">
        <section id="guide-top" className="mb-8 scroll-mt-24" aria-labelledby="guide-title">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Java Journal</Badge>
            <Badge variant="outline">{helpSections.length} sections</Badge>
            <Badge variant="outline">{totalTopics} topics</Badge>
          </div>
          <h1 id="guide-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Get more from your trading journal</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
            A complete guide to importing fills, matching trades, interpreting performance, and keeping useful journals.
            Browse a section or search for a feature, metric, or action.
          </p>
          <Card className="mt-6">
            <CardContent className="p-4 sm:p-5">
              <label htmlFor="help-search" className="mb-2 block text-sm font-medium">Search the user guide</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="help-search"
                  type="search"
                  value={search}
                  onChange={event => updateSearch(event.target.value)}
                  placeholder="Try CSV import, P&L, split execution, or journal"
                  className="h-11 pl-10 pr-12"
                  aria-describedby="help-search-summary"
                />
                {search && (
                  <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={clearSearch} aria-label="Clear guide search">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p id="help-search-summary" className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
                  {search.trim() ? `${topicIds.length} of ${totalTopics} topics match your search.` : 'Select a topic to read its instructions. Search matches open automatically.'}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setExpandedTopics(topicIds)} disabled={topicIds.length === 0}>Expand all</Button>
                  <Button variant="ghost" size="sm" onClick={() => setExpandedTopics([])} disabled={expandedTopics.length === 0}>Collapse all</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          <aside className="lg:sticky lg:top-24">
            <nav aria-label="Help guide sections" className="rounded-xl border border-border bg-card p-3 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
              <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Browse sections</h2>
              <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
                {sections.map(section => (
                  <Link
                    key={section.id}
                    to={`/help#${section.id}`}
                    onClick={() => setExpandedTopics(current => [...new Set([...current, ...section.topics.map(topic => topic.id)])])}
                    aria-current={location.hash === `#${section.id}` ? 'location' : undefined}
                    className={`flex shrink-0 items-center justify-between gap-3 rounded-md px-2 py-2 text-sm transition-colors lg:shrink ${location.hash === `#${section.id}` ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                  >
                    <span className="whitespace-nowrap lg:whitespace-normal">{section.title}</span>
                    <span className="text-xs tabular-nums">{section.topics.length}</span>
                  </Link>
                ))}
              </div>
              <Link to="/help#guide-top" className="mt-3 hidden items-center gap-2 border-t border-border px-2 pt-3 text-sm text-muted-foreground hover:text-foreground lg:flex">
                <ArrowUp className="h-4 w-4" aria-hidden="true" /> Back to search
              </Link>
            </nav>
          </aside>

          <div className="min-w-0 space-y-6">
            {sections.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center" role="status">
                  <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <h2 className="text-lg font-semibold">No topics found</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Try a shorter phrase such as account, import, matching, or P&L.</p>
                  <Button className="mt-4" variant="outline" onClick={clearSearch}>Show all topics</Button>
                </CardContent>
              </Card>
            ) : sections.map(section => (
              <section key={section.id} id={section.id} className="scroll-mt-24 rounded-xl border border-border bg-card" aria-labelledby={`${section.id}-title`}>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h2 id={`${section.id}-title`} className="text-xl font-semibold">{section.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{section.description}</p>
                </div>
                <Accordion type="multiple" value={expandedTopics} onValueChange={setExpandedTopics} className="px-4 sm:px-6">
                  {section.topics.map(topic => (
                    <AccordionItem key={topic.id} value={topic.id}>
                      <AccordionTrigger className="text-base">{topic.title}</AccordionTrigger>
                      <AccordionContent className="space-y-4 pb-6 text-sm leading-6">
                        {topic.paragraphs.map(paragraph => <p key={paragraph} className="text-muted-foreground">{paragraph}</p>)}
                        {topic.steps && (
                          <ol className="list-decimal space-y-2 pl-5 marker:font-medium marker:text-primary">
                            {topic.steps.map(step => <li key={step} className="pl-1">{step}</li>)}
                          </ol>
                        )}
                        {topic.tips && (
                          <div className="rounded-lg bg-secondary/50 p-3 sm:p-4">
                            <h3 className="mb-1 font-medium">Good to know</h3>
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                              {topic.tips.map(tip => <li key={tip}>{tip}</li>)}
                            </ul>
                          </div>
                        )}
                        {topic.warning && (
                          <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 sm:p-4">
                            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                            <div>
                              <h3 className="font-medium">Before you proceed</h3>
                              <p className="mt-1 text-muted-foreground">{topic.warning}</p>
                            </div>
                          </div>
                        )}
                        {topic.links && (
                          <div className="flex flex-wrap gap-2">
                            {topic.links.map(link => (
                              <Button key={link.to} asChild variant="outline" size="sm">
                                <Link to={link.to}>{link.label}<ChevronRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
                              </Button>
                            ))}
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
              <p>Journal actions change your stored records, not your broker positions. Keep original reports and backups.</p>
              <Link to="/help#guide-top" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"><ArrowUp className="h-3 w-3" aria-hidden="true" /> Back to top</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
