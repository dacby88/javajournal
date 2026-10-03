import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import type { TradeTag, EventTag } from '@/types';
import { 
  Plus, 
  Loader2, 
  Tag,
  Trash2,
  Edit2,
  Save,
  Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SimpleNav } from './SimpleNav';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#6b7280', // gray
  '#1f2937', // dark gray
];

export function SettingsPage() {
  const [tags, setTags] = useState<TradeTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state for creating/editing trade tags
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#3b82f6');
  const [tagDescription, setTagDescription] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Event tags state
  const [eventTags, setEventTags] = useState<EventTag[]>([]);
  const [eventTagsLoading, setEventTagsLoading] = useState(true);
  const [editingEventTagId, setEditingEventTagId] = useState<number | null>(null);
  const [eventTagName, setEventTagName] = useState('');
  const [eventTagColor, setEventTagColor] = useState('#3b82f6');
  const [eventTagDescription, setEventTagDescription] = useState('');
  const [savingEventTag, setSavingEventTag] = useState(false);

  useEffect(() => {
    fetchTags();
    fetchEventTags();
  }, []);

  const fetchTags = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getTags();
      if (response.success) {
        setTags(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tags');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchEventTags = async () => {
    try {
      setEventTagsLoading(true);
      const response = await api.getEventTags();
      if (response.success) {
        setEventTags(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch event tags');
    } finally {
      setEventTagsLoading(false);
    }
  };

  const handleCreateTag = async () => {
    if (!tagName.trim()) {
      setError('Tag name is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await api.createTag({
        name: tagName.trim(),
        color: tagColor,
        description: tagDescription.trim(),
      });

      if (response.success) {
        setTags(prev => [...prev, response.data]);
        resetForm();
        setSuccess('Tag created successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTag = async () => {
    if (!editingTagId || !tagName.trim()) {
      setError('Tag name is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await api.updateTag(editingTagId, {
        name: tagName.trim(),
        color: tagColor,
        description: tagDescription.trim(),
      });

      if (response.success) {
        setTags(prev => prev.map(t => t.id === editingTagId ? response.data : t));
        resetForm();
        setSuccess('Tag updated successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tag');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTag = async (tagId: number) => {
    if (!confirm('Are you sure you want to delete this tag? It will be removed from all trades.')) {
      return;
    }

    try {
      setError(null);
      const response = await api.deleteTag(tagId);
      if (response.success) {
        setTags(prev => prev.filter(t => t.id !== tagId));
        if (editingTagId === tagId) {
          resetForm();
        }
        setSuccess('Tag deleted successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tag');
    }
  };

  const startEdit = (tag: TradeTag) => {
    setEditingTagId(tag.id);
    setTagName(tag.name);
    setTagColor(tag.color);
    setTagDescription(tag.description || '');
  };

  const resetForm = () => {
    setEditingTagId(null);
    setTagName('');
    setTagColor('#3b82f6');
    setTagDescription('');
  };
  
  const resetEventTagForm = () => {
    setEditingEventTagId(null);
    setEventTagName('');
    setEventTagColor('#3b82f6');
    setEventTagDescription('');
  };
  
  // Event Tag handlers
  const handleCreateEventTag = async () => {
    if (!eventTagName.trim()) {
      setError('Event tag name is required');
      return;
    }

    try {
      setSavingEventTag(true);
      setError(null);
      const response = await api.createEventTag({
        name: eventTagName.trim(),
        color: eventTagColor,
        description: eventTagDescription.trim(),
      });

      if (response.success) {
        setEventTags(prev => [...prev, response.data]);
        resetEventTagForm();
        setSuccess('Event tag created successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event tag');
    } finally {
      setSavingEventTag(false);
    }
  };

  const handleUpdateEventTag = async () => {
    if (!editingEventTagId || !eventTagName.trim()) {
      setError('Event tag name is required');
      return;
    }

    try {
      setSavingEventTag(true);
      setError(null);
      const response = await api.updateEventTag(editingEventTagId, {
        name: eventTagName.trim(),
        color: eventTagColor,
        description: eventTagDescription.trim(),
      });

      if (response.success) {
        setEventTags(prev => prev.map(t => t.id === editingEventTagId ? response.data : t));
        resetEventTagForm();
        setSuccess('Event tag updated successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event tag');
    } finally {
      setSavingEventTag(false);
    }
  };

  const handleDeleteEventTag = async (tagId: number) => {
    if (!confirm('Are you sure you want to delete this event tag? It will be removed from all journals.')) {
      return;
    }

    try {
      setError(null);
      const response = await api.deleteEventTag(tagId);
      if (response.success) {
        setEventTags(prev => prev.filter(t => t.id !== tagId));
        if (editingEventTagId === tagId) {
          resetEventTagForm();
        }
        setSuccess('Event tag deleted successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event tag');
    }
  };

  const startEditEventTag = (tag: EventTag) => {
    setEditingEventTagId(tag.id);
    setEventTagName(tag.name);
    setEventTagColor(tag.color);
    setEventTagDescription(tag.description || '');
  };

  return (
    <div className="min-h-screen bg-background">
      <SimpleNav title="Settings" />

      <main className="container mx-auto px-4 py-6">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="mb-6 bg-green-500/10 text-green-600 border-green-500/20">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="tags" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="tags" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Trade Tags
            </TabsTrigger>
            <TabsTrigger value="event-tags" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Event Tags
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tags">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Tag List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Tag className="h-5 w-5" />
                    Your Tags
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Loading tags...
                    </div>
                  ) : tags.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No tags yet. Create your first tag to get started.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tags.map(tag => (
                        <div
                          key={tag.id}
                          className={`flex items-center justify-between p-3 rounded-lg border ${editingTagId === tag.id ? 'bg-accent border-accent' : 'hover:bg-secondary/50'}`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="w-4 h-4 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <div>
                              <div className="font-medium">{tag.name}</div>
                              {tag.description && (
                                <div className="text-sm text-muted-foreground">{tag.description}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => startEdit(tag)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDeleteTag(tag.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Create/Edit Tag Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {editingTagId ? (
                      <>
                        <Edit2 className="h-5 w-5" />
                        Edit Tag
                      </>
                    ) : (
                      <>
                        <Plus className="h-5 w-5" />
                        Create New Tag
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={(e) => { e.preventDefault(); editingTagId ? handleUpdateTag() : handleCreateTag(); }} className="space-y-4">
                    <div>
                      <Label htmlFor="tagName">Tag Name *</Label>
                      <Input
                        id="tagName"
                        value={tagName}
                        onChange={(e) => setTagName(e.target.value)}
                        placeholder="e.g., Scalping, Swing Trade, High Conviction"
                      />
                    </div>

                    <div>
                      <Label>Color</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {PRESET_COLORS.map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setTagColor(color)}
                            className={`w-8 h-8 rounded-full border-2 ${tagColor === color ? 'border-foreground ring-2 ring-ring' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="color"
                          value={tagColor}
                          onChange={(e) => setTagColor(e.target.value)}
                          className="w-10 h-10 rounded cursor-pointer"
                        />
                        <Input
                          value={tagColor}
                          onChange={(e) => setTagColor(e.target.value)}
                          placeholder="#3b82f6"
                          className="w-28 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="tagDescription">Description (optional)</Label>
                      <Input
                        id="tagDescription"
                        value={tagDescription}
                        onChange={(e) => setTagDescription(e.target.value)}
                        placeholder="Brief description of this tag"
                      />
                    </div>

                    <div className="pt-4">
                      <Label>Preview</Label>
                      <div className="mt-2">
                        <Badge
                          style={{ backgroundColor: tagColor, color: '#fff' }}
                          className="px-3 py-1 text-sm"
                        >
                          {tagName || 'Tag Preview'}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4">
                      {editingTagId ? (
                        <>
                          <Button
                            type="submit"
                            disabled={saving || !tagName.trim()}
                            className="flex-1"
                          >
                            {saving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="h-4 w-4 mr-2" />
                                Update Tag
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={resetForm}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="submit"
                          disabled={saving || !tagName.trim()}
                          className="w-full"
                        >
                          {saving ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" />
                              Create Tag
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Event Tags Tab */}
          <TabsContent value="event-tags">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Event Tag List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Your Event Tags
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {eventTagsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Loading event tags...
                    </div>
                  ) : eventTags.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No event tags yet. Create your first event tag to get started.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {eventTags.map(tag => (
                        <div
                          key={tag.id}
                          className={`flex items-center justify-between p-3 rounded-lg border ${editingEventTagId === tag.id ? 'bg-accent border-accent' : 'hover:bg-secondary/50'}`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="w-4 h-4 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <div>
                              <div className="font-medium">{tag.name}</div>
                              {tag.description && (
                                <div className="text-sm text-muted-foreground">{tag.description}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => startEditEventTag(tag)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDeleteEventTag(tag.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Create/Edit Event Tag Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {editingEventTagId ? (
                      <>
                        <Edit2 className="h-5 w-5" />
                        Edit Event Tag
                      </>
                    ) : (
                      <>
                        <Plus className="h-5 w-5" />
                        Create New Event Tag
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={(e) => { e.preventDefault(); editingEventTagId ? handleUpdateEventTag() : handleCreateEventTag(); }} className="space-y-4">
                    <div>
                      <Label htmlFor="eventTagName">Event Tag Name *</Label>
                      <Input
                        id="eventTagName"
                        value={eventTagName}
                        onChange={(e) => setEventTagName(e.target.value)}
                        placeholder="e.g., FOMC, NFP, Earnings, CPI"
                      />
                    </div>

                    <div>
                      <Label>Color</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {PRESET_COLORS.map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setEventTagColor(color)}
                            className={`w-8 h-8 rounded-full border-2 ${eventTagColor === color ? 'border-foreground ring-2 ring-ring' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="color"
                          value={eventTagColor}
                          onChange={(e) => setEventTagColor(e.target.value)}
                          className="w-10 h-10 rounded cursor-pointer"
                        />
                        <Input
                          value={eventTagColor}
                          onChange={(e) => setEventTagColor(e.target.value)}
                          placeholder="#3b82f6"
                          className="w-28 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="eventTagDescription">Description (optional)</Label>
                      <Input
                        id="eventTagDescription"
                        value={eventTagDescription}
                        onChange={(e) => setEventTagDescription(e.target.value)}
                        placeholder="Brief description of this event tag"
                      />
                    </div>

                    <div className="pt-4">
                      <Label>Preview</Label>
                      <div className="mt-2">
                        <Badge
                          style={{ backgroundColor: eventTagColor, color: '#fff' }}
                          className="px-3 py-1 text-sm"
                        >
                          {eventTagName || 'Event Tag Preview'}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4">
                      {editingEventTagId ? (
                        <>
                          <Button
                            type="submit"
                            disabled={savingEventTag || !eventTagName.trim()}
                            className="flex-1"
                          >
                            {savingEventTag ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="h-4 w-4 mr-2" />
                                Update Event Tag
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={resetEventTagForm}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="submit"
                          disabled={savingEventTag || !eventTagName.trim()}
                          className="w-full"
                        >
                          {savingEventTag ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" />
                              Create Event Tag
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default SettingsPage;
