import React, { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Rect, Group, Text } from "react-konva";
import useImage from "use-image";

// --- Configuration ---
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

// --- Types & Constants ---

type ToolType = "select" | "hand";

interface DesignObject {
  id: string;
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  src: string;        // Thumbnail URL (for Canvas)
  highResSrc?: string; // Original URL (for Server Export)
  zIndex: number;
}

interface UploadedFile {
    id: string;
    src: string;         // Thumbnail URL
    highResSrc?: string; // Original URL
    width: number;
    height: number;
    name: string;
    isUploading?: boolean; // UI state
}

interface SizeOption {
  label: string;
  width: number; // in pixels (assuming 96 DPI or base unit)
  height: number;
}

// 1 inch = 96px approximately for screen display
const PPI = 96;
const SIZE_OPTIONS: SizeOption[] = [
  { label: "22 x 12 in", width: 22 * PPI, height: 12 * PPI },
  { label: "22 x 24 in", width: 22 * PPI, height: 24 * PPI },
  { label: "22 x 36 in", width: 22 * PPI, height: 36 * PPI },
  { label: "22 x 48 in", width: 22 * PPI, height: 48 * PPI },
  { label: "22 x 60 in", width: 22 * PPI, height: 60 * PPI },
];

const generateId = () => Math.random().toString(36).substr(2, 9);

// --- Collision Logic ---
interface Point { x: number; y: number; }

function getRotatedCorners(obj: DesignObject, buffer: number = 0): Point[] {
    const rad = (obj.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Handle negative scales (flipped images)
    const w = obj.width * Math.abs(obj.scaleX) + buffer * 2;
    const h = obj.height * Math.abs(obj.scaleY) + buffer * 2;

    const ox = obj.x;
    const oy = obj.y;

    // Local corners (unrotated, relative to x,y)
    // We need to apply the buffer.
    const corners = [
        { x: -buffer, y: -buffer },
        { x: w - buffer, y: -buffer },
        { x: w - buffer, y: h - buffer },
        { x: -buffer, y: h - buffer }
    ];

    return corners.map(p => ({
        x: p.x * cos - p.y * sin + ox,
        y: p.x * sin + p.y * cos + oy
    }));
}

function doPolygonsIntersect(a: Point[], b: Point[]): boolean {
    const polygons = [a, b];
    for (let i = 0; i < polygons.length; i++) {
        const polygon = polygons[i];
        for (let j = 0; j < polygon.length; j++) {
            const p1 = polygon[j];
            const p2 = polygon[(j + 1) % polygon.length];
            const normal = { x: p2.y - p1.y, y: p1.x - p2.x };

            let minA = Infinity, maxA = -Infinity;
            for (const p of a) {
                const projected = normal.x * p.x + normal.y * p.y;
                if (projected < minA) minA = projected;
                if (projected > maxA) maxA = projected;
            }

            let minB = Infinity, maxB = -Infinity;
            for (const p of b) {
                const projected = normal.x * p.x + normal.y * p.y;
                if (projected < minB) minB = projected;
                if (projected > maxB) maxB = projected;
            }

            if (maxA < minB || maxB < minA) return false;
        }
    }
    return true;
}

// --- Components ---

// Simple SVG Icons
const Icons = {
  Undo: () => <svg className="icon" viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>,
  Redo: () => <svg className="icon" viewBox="0 0 24 24"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7"/></svg>,
  Plus: () => <svg className="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Minus: () => <svg className="icon" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Image: () => <svg className="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Trash: () => <svg className="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  Cursor: () => <svg className="icon" viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>,
  Hand: () => <svg className="icon" viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>,
  Copy: () => <svg className="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  CloudUpload: () => <svg className="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Save: () => <svg className="icon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  Share: () => <svg className="icon" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Download: () => <svg className="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
};

// Input Component that handles local state for smooth typing
const PropertyInput = ({ value, onChange, onCommit }: { value: number, onChange: (val: number) => void, onCommit: () => void }) => {
    const [localValue, setLocalValue] = useState(value.toFixed(2));
    const [isFocused, setIsFocused] = useState(false);

    // Sync with external changes (drag, undo) ONLY if not being edited
    useEffect(() => {
        if (!isFocused) {
            setLocalValue(value.toFixed(2));
        }
    }, [value, isFocused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const str = e.target.value;
        setLocalValue(str);
        
        const val = parseFloat(str);
        if (!isNaN(val) && val > 0) {
            onChange(val);
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        const val = parseFloat(localValue);
        // Reset to valid prop value if invalid
        if (isNaN(val) || val <= 0) {
            setLocalValue(value.toFixed(2));
        } else {
            setLocalValue(val.toFixed(2));
        }
        onCommit();
    };

    const handleFocus = () => {
        setIsFocused(true);
    };

    return (
        <input 
            type="number" 
            step="0.1"
            className="w-full border rounded px-2 py-1 text-xs bg-white text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-none"
            value={localValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={(e) => {
                if(e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                }
            }}
        />
    );
};

// Image Object Component
const URLImage = ({ 
  src, id, isSelected, activeTool, isSpacePressed, 
  onDragStart, onDragEnd, onDragMove, onTransformStart, onTransformEnd, 
  x, y, rotation, scaleX, scaleY, width, height, ...props 
}: any) => {
  const [image, status] = useImage(src, "anonymous");
  // Only draggable if using select tool and NOT holding spacebar (hand mode)
  const isDraggable = activeTool === 'select' && !isSpacePressed;
  
  // Shadow state for overlap feedback
  const [shadowColor, setShadowColor] = useState('transparent');
  const [isDraggingLocal, setIsDraggingLocal] = useState(false);

  return (
    <Group
        id={id}
        x={x}
        y={y}
        rotation={rotation}
        scaleX={scaleX}
        scaleY={scaleY}
        draggable={isDraggable}
        onDragStart={(e) => {
            setIsDraggingLocal(true);
            onDragStart && onDragStart(e);
        }}
        onDragMove={(e) => {
            onDragMove && onDragMove(e);
        }}
        onDragEnd={(e) => {
            setIsDraggingLocal(false);
            setShadowColor('transparent');
            onDragEnd && onDragEnd(e);
        }}
        onTransformStart={(e) => {
            setIsDraggingLocal(true);
            onTransformStart && onTransformStart(e);
        }}
        onTransformEnd={(e) => {
            setIsDraggingLocal(false);
            onTransformEnd && onTransformEnd(e);
        }}
    >
      {status === 'loaded' ? (
        <KonvaImage 
            image={image} 
            width={width}
            height={height}
            shadowColor={shadowColor}
            shadowBlur={isDraggingLocal ? 10 : 0}
            {...props}
        />
      ) : (
        <Group>
            <Rect 
                width={width} 
                height={height} 
                fill="#f3f4f6" 
                stroke="#d1d5db" 
                strokeWidth={2}
                dash={[10, 5]}
            />
            <Text 
                text="Loading..." 
                width={width} 
                height={height} 
                align="center" 
                verticalAlign="middle" 
                fontSize={Math.max(14, Math.min(width, height) / 10)}
                fill="#6b7280"
            />
        </Group>
      )}
    </Group>
  );
};


const App = () => {
  const [size, setSize] = useState<SizeOption>(SIZE_OPTIONS[0]);
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [objects, setObjects] = useState<DesignObject[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, x: number, y: number, width: number, height: number } | null>(null);
  const [history, setHistory] = useState<DesignObject[][]>([[]]);
  const [historyStep, setHistoryStep] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [designId, setDesignId] = useState<string | null>(null);
  
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartAttrs = useRef<Map<string, DesignObject>>(new Map());

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 3.0;

  // --- Load Design from URL on Startup ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('designId');
    if (id) {
        setDesignId(id);
        fetch(`${API_URL}/designs/${id}`)
            .then(res => {
                if(!res.ok) throw new Error("Design not found");
                return res.json();
            })
            .then(data => {
                if (data.objects) setObjects(data.objects);
                if (data.size) setSize(data.size);
                if (data.uploadedFiles) setUploadedFiles(data.uploadedFiles);
                setHistory([data.objects || []]);
            })
            .catch(err => {
                console.error("Failed to load design", err);
                alert("Could not load the design. Starting fresh.");
            });
    }
  }, []);


  const saveHistory = useCallback((newObjects: DesignObject[]) => {
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(newObjects);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
    setObjects(newObjects);
  }, [history, historyStep]);

  const undo = useCallback(() => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
      setObjects(history[historyStep - 1]);
      setSelectedIds([]);
    }
  }, [history, historyStep]);

  const redo = useCallback(() => {
    if (historyStep < history.length - 1) {
      setHistoryStep(historyStep + 1);
      setObjects(history[historyStep + 1]);
      setSelectedIds([]);
    }
  }, [history, historyStep]);

  const checkOverlap = useCallback((target: DesignObject, potentialObjects?: DesignObject[]): boolean => {
      const objList = potentialObjects || objects;
      if (objList.length <= 1) return false;

      const buffer = 0.25 * PPI; 
      const targetCorners = getRotatedCorners(target, buffer);

      for (const obj of objList) {
          if (obj.id === target.id) continue;
          
          const objCorners = getRotatedCorners(obj, buffer);
          if (doPolygonsIntersect(targetCorners, objCorners)) {
              return true;
          }
      }
      return false;
  }, [objects]);

  const addObject = useCallback((obj: DesignObject) => {
    if (objects.some(o => o.id === obj.id)) return;
    const newObjects = [...objects, obj];
    saveHistory(newObjects);
    setSelectedIds([obj.id]);
    setActiveTool('select');
  }, [objects, saveHistory]);

  // --- UPDATED: Upload to Server (Receive Thumb + HighRes) ---
  const processFile = useCallback(async (file: File) => {
    const tempId = generateId();
    
    // UI placeholder
    const placeholder: UploadedFile = {
        id: tempId,
        src: URL.createObjectURL(file), // Local preview
        width: 0,
        height: 0,
        name: file.name,
        isUploading: true
    };
    
    const img = new Image();
    img.src = placeholder.src;
    img.onload = () => {
        placeholder.width = img.naturalWidth;
        placeholder.height = img.naturalHeight;
        setUploadedFiles(prev => [...prev, placeholder]);
    };

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error("Upload failed");
        
        const data = await response.json();
        
        setUploadedFiles(prev => prev.map(f => {
            if (f.id === tempId) {
                return {
                    ...f,
                    src: data.url,        // Low-Res Thumbnail
                    highResSrc: data.highResUrl, // Original High-Res
                    isUploading: false
                };
            }
            return f;
        }));

    } catch (err) {
        console.error(err);
        alert("Failed to upload image.");
        setUploadedFiles(prev => prev.filter(f => f.id !== tempId));
    }
  }, []);

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
        (Array.from(e.target.files) as File[]).forEach(file => {
            processFile(file);
        });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
        (Array.from(e.dataTransfer.files) as File[]).forEach(file => {
             if (file.type.startsWith('image/')) {
                 processFile(file);
             }
        });
    }
  };
  
  const handleDeleteUpload = (id: string) => {
      setUploadedFiles(prev => prev.filter(f => f.id !== id));
  };

  const addToCanvas = (file: UploadedFile) => {
    if (file.isUploading) {
        alert("Please wait for image to finish uploading.");
        return;
    }
    
    const maxInches = 10;
    const maxPx = maxInches * PPI;
    let scale = 1;
    if (file.width > maxPx) {
        scale = maxPx / file.width;
    }

    const count = objects.length;
    const offset = (count % 10) * 20;
    
    const newObj: DesignObject = {
        id: generateId(), 
        type: "image",
        x: 50 + offset, 
        y: 50 + offset,
        src: file.src,          // Use Thumbnail
        highResSrc: file.highResSrc, // Store High-Res ref
        rotation: 0,
        scaleX: scale,
        scaleY: scale,
        width: file.width,
        height: file.height,
        zIndex: objects.length,
    };
    addObject(newObj);
  };

  const getUpdatedObjects = (id: string, attrs: Partial<DesignObject>) => {
      return objects.map((obj) =>
        obj.id === id ? { ...obj, ...attrs } : obj
      );
  };

  const handleDelete = useCallback(() => {
    if (selectedIds.length > 0) {
      const newObjects = objects.filter((o) => !selectedIds.includes(o.id));
      saveHistory(newObjects);
      setSelectedIds([]);
    }
  }, [selectedIds, objects, saveHistory]);

  const deleteSingle = (id: string) => {
      const newObjects = objects.filter((o) => o.id !== id);
      saveHistory(newObjects);
      setSelectedIds(prev => prev.filter(pid => pid !== id));
  }
  
  const handleDuplicate = useCallback(() => {
      if (selectedIds.length === 0) return;

      const newObjectsToAdd: DesignObject[] = [];
      const newSelectedIds: string[] = [];
      const OFFSET = 30; 

      objects.forEach(obj => {
          if (selectedIds.includes(obj.id)) {
              const newId = generateId();
              const newObj = {
                  ...obj,
                  id: newId,
                  x: obj.x + OFFSET,
                  y: obj.y + OFFSET,
                  zIndex: objects.length + newObjectsToAdd.length
              };
              newObjectsToAdd.push(newObj);
              newSelectedIds.push(newId);
          }
      });

      if (newObjectsToAdd.length > 0) {
          const updatedObjects = [...objects, ...newObjectsToAdd];
          saveHistory(updatedObjects);
          setSelectedIds(newSelectedIds);
      }
  }, [selectedIds, objects, saveHistory]);

  const handleSave = async () => {
    if (objects.length === 0 && uploadedFiles.length === 0) return;
    
    setIsSaving(true);
    const saveId = designId || generateId();
    
    const projectData = {
        size: size,
        objects: objects,
        uploadedFiles: uploadedFiles
    };

    try {
        const response = await fetch(`${API_URL}/designs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: saveId, data: projectData })
        });
        
        if (!response.ok) throw new Error("Save failed");
        
        setDesignId(saveId);
        const newUrl = `${window.location.pathname}?designId=${saveId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        alert("Design saved! You can share this URL.");
    } catch (err) {
        console.error(err);
        alert("Failed to save design.");
    } finally {
        setIsSaving(false);
    }
  };

  // --- UPDATED: Server-Side Export ---
  const handleExport = async () => {
      if (objects.length === 0) {
          alert("Please add images to the canvas before exporting.");
          return;
      }
      
      // Check if images have highResSrc (uploaded images)
      const imagesWithoutHighRes = objects.filter(obj => 
          obj.type === 'image' && !obj.highResSrc
      );
      
      if (imagesWithoutHighRes.length > 0) {
          const confirm = window.confirm(
              `${imagesWithoutHighRes.length} image(s) haven't been uploaded yet. ` +
              `The export will use lower resolution thumbnails. ` +
              `For best quality, please upload images first. Continue anyway?`
          );
          if (!confirm) return;
      }
      
      setIsExporting(true);
      try {
          const response = await fetch(`${API_URL}/export`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ size, objects })
          });

          if (!response.ok) {
              // Try to parse error message from JSON
              let errorMessage = "Export failed";
              try {
                  const errorData = await response.json();
                  errorMessage = errorData.error || errorData.details || errorMessage;
              } catch {
                  // If not JSON, use status text
                  errorMessage = response.statusText || errorMessage;
              }
              throw new Error(errorMessage);
          }

          // Check if response is actually an image
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.startsWith('image/')) {
              // Might be an error JSON
              const errorData = await response.json();
              throw new Error(errorData.error || "Invalid response from server");
          }

          // Convert response blob to download link
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `gang-sheet-HQ-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
          
      } catch (err: any) {
          console.error("Export Error:", err);
          const errorMsg = err.message || "Failed to create High-Res export.";
          alert(errorMsg + "\n\nPlease ensure:\n- Images are uploaded\n- Server is running\n- Images are accessible");
      } finally {
          setIsExporting(false);
      }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
           e.preventDefault();
        }
        setIsSpacePressed(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
          e.preventDefault();
          handleDuplicate();
      }
      
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
          if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
               handleDelete();
          }
      }
    };
    
    const handleBlur = () => {
        setIsSpacePressed(false);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [selectedIds, objects, handleDuplicate, handleDelete]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!containerRef.current) return;
    
    if (!isSpacePressed) {
        setPan(prev => ({
            x: prev.x - e.deltaX,
            y: prev.y - e.deltaY
        }));
        return;
    }
    
    if (e.deltaY === 0) return;
    
    const delta = Math.abs(e.deltaY);
    const scaleBy = 1.01 + Math.max(0.04, delta * 0.001);

    const oldZoom = zoom;
    let newZoom = e.deltaY < 0 ? oldZoom * scaleBy : oldZoom / scaleBy;
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const mouseX = e.clientX - rect.left - centerX;
    const mouseY = e.clientY - rect.top - centerY;

    const newPanX = mouseX - (mouseX - pan.x) * (newZoom / oldZoom);
    const newPanY = mouseY - (mouseY - pan.y) * (newZoom / oldZoom);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan, isSpacePressed]);

  const handleStageMouseDown = (e: any) => {
    if (e.target.getParent()?.className === 'Transformer') {
      return;
    }

    const isMiddleClick = e.evt.button === 1;
    const isHandMode = activeTool === 'hand' || isSpacePressed || isMiddleClick;

    const stage = e.target.getStage();
    
    if (isHandMode) {
        setIsPanning(true);
        if (isMiddleClick) {
             e.evt.preventDefault();
        }
        return;
    }

    const pos = stage.getPointerPosition();
    const transform = stageRef.current.getLayers()[0].getAbsoluteTransform().copy();
    transform.invert();
    const localPos = transform.point(pos);

    if (activeTool === 'select') {
        const clickedOnEmpty = e.target === stage;

        if (clickedOnEmpty) {
            setSelectionBox({
                startX: localPos.x,
                startY: localPos.y,
                x: localPos.x,
                y: localPos.y,
                width: 0,
                height: 0
            });
            const isMultiSelect = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
            if (!isMultiSelect) {
                setSelectedIds([]);
            }
        } else {
            // Find the Group that has the ID (traverse up parent chain)
            let targetNode = e.target;
            let clickedId = null;
            
            // Traverse up to find a node with an ID (the Group wrapper)
            while (targetNode && targetNode !== stage) {
                const id = targetNode.id();
                if (id) {
                    clickedId = id;
                    break;
                }
                targetNode = targetNode.getParent();
            }
            
            if (clickedId) {
                const isMultiSelect = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
                
                if (isMultiSelect) {
                    if (selectedIds.includes(clickedId)) {
                        setSelectedIds(ids => ids.filter(id => id !== clickedId));
                    } else {
                        setSelectedIds(ids => [...ids, clickedId]);
                    }
                } else {
                    if (!selectedIds.includes(clickedId)) {
                        setSelectedIds([clickedId]);
                    }
                }
            }
        }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
        setPan(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
        return;
    }

    if (selectionBox) {
        if (stageRef.current) {
            const stage = stageRef.current;
            const pos = stage.getPointerPosition();
            const transform = stage.getLayers()[0].getAbsoluteTransform().copy();
            transform.invert();
            const localPos = transform.point(pos);

            setSelectionBox(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    x: Math.min(prev.startX, localPos.x),
                    y: Math.min(prev.startY, localPos.y),
                    width: Math.abs(localPos.x - prev.startX),
                    height: Math.abs(localPos.y - prev.startY)
                };
            });
        }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);

    if (selectionBox) {
        const sb = selectionBox;
        const boxRect = {
            x: sb.x,
            y: sb.y,
            width: sb.width,
            height: sb.height
        };

        const selected = objects.filter((obj) => {
            const objRect = {
                x: obj.x,
                y: obj.y,
                width: obj.width * obj.scaleX,
                height: obj.height * obj.scaleY
            };
            
            return (
                boxRect.x < objRect.x + objRect.width &&
                boxRect.x + boxRect.width > objRect.x &&
                boxRect.y < objRect.y + objRect.height &&
                boxRect.y + boxRect.height > objRect.y
            );
        });

        const ids = selected.map(o => o.id);
        if (ids.length > 0) {
            setSelectedIds(ids);
        }
        
        setSelectionBox(null);
    }
  };
  
  const onDragStart = (e: any) => {
      const id = e.target.id();
      const node = e.target;
      
      if (selectedIds.includes(id)) {
          selectedIds.forEach(sId => {
              const sNode = stageRef.current.findOne('#' + sId);
              const obj = objects.find(o => o.id === sId);
              if (sNode && obj) {
                  dragStartAttrs.current.set(sId, {
                      ...obj,
                      x: sNode.x(),
                      y: sNode.y()
                  });
              }
          });
      } else {
          const obj = objects.find(o => o.id === id);
          if (obj) {
              dragStartAttrs.current.set(id, { ...obj, x: node.x(), y: node.y() });
          }
      }
      setIsDragging(true);
  };
  
  const onDragMove = (e: any) => {
      const id = e.target.id();
      if (selectedIds.includes(id) && selectedIds.length > 1) {
          const startAttrs = dragStartAttrs.current.get(id);
          if (!startAttrs) return;
          
          const dx = e.target.x() - startAttrs.x;
          const dy = e.target.y() - startAttrs.y;
          
          selectedIds.forEach(sId => {
              if (sId !== id) {
                  const node = stageRef.current.findOne('#' + sId);
                  const sStart = dragStartAttrs.current.get(sId);
                  if (node && sStart) {
                      node.position({
                          x: sStart.x + dx,
                          y: sStart.y + dy
                      });
                  }
              }
          });
      }
  };
  
  const onDragEnd = (e: any) => {
      const id = e.target.id();
      const idsToUpdate = selectedIds.includes(id) ? selectedIds : [id];
      
      const potentialObjects = objects.map(obj => {
          if (idsToUpdate.includes(obj.id)) {
              const node = stageRef.current.findOne('#' + obj.id);
              if (node) {
                  return { ...obj, x: node.x(), y: node.y() };
              }
          }
          return obj;
      });

      saveHistory(potentialObjects);
      setIsDragging(false);
      dragStartAttrs.current.clear();
  };
  
  const onTransformStart = (e: any) => {
      const id = e.target.id();
      const obj = objects.find(o => o.id === id);
      if(obj) {
          dragStartAttrs.current.set(id, {...obj});
      }
      setIsDragging(true);
  };
  
  const onTransformEnd = (e: any) => {
      const node = e.target;
      const id = node.id();
      
      const finalObjects = getUpdatedObjects(id, {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      });

      saveHistory(finalObjects);
      setIsDragging(false);
  };

  useEffect(() => {
    if (transformerRef.current && stageRef.current) {
        const tr = transformerRef.current;
        const timeout = setTimeout(() => {
            if(!stageRef.current) return;
            const nodes = selectedIds.map(id => stageRef.current.findOne('#' + id)).filter(Boolean);
            tr.nodes(nodes);
            tr.getLayer().batchDraw();
        }, 10);
        
        return () => clearTimeout(timeout);
    }
  }, [selectedIds, objects]);

  const selectedObject = selectedIds.length === 1 
      ? objects.find((o) => o.id === selectedIds[0]) 
      : null;

  const isHandActive = activeTool === 'hand' || isSpacePressed;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-16 border-b bg-white flex items-center px-4 justify-between z-10 shadow-sm shrink-0">
        <div className="flex items-center space-x-4">
          <div className="flex bg-gray-100 p-1 rounded-md border border-gray-200">
             <button 
                onClick={() => setActiveTool('select')}
                className={`p-1.5 rounded ${activeTool === 'select' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="Select (V)"
             >
                <Icons.Cursor />
             </button>
             <button 
                onClick={() => setActiveTool('hand')}
                className={`p-1.5 rounded ${activeTool === 'hand' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="Hand (H or Spacebar)"
             >
                <Icons.Hand />
             </button>
          </div>
          <div className="h-6 w-px bg-gray-300 mx-2"></div>
          <select
            className="border rounded px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500"
            value={size.label}
            onChange={(e) => {
              const s = SIZE_OPTIONS.find((opt) => opt.label === e.target.value);
              if (s) setSize(s);
            }}
          >
            {SIZE_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.label}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center space-x-2">
            <button 
                onClick={handleSave} 
                disabled={isSaving}
                className="flex items-center space-x-2 px-3 py-2 rounded hover:bg-gray-100 text-sm font-medium text-gray-700 border border-gray-300 disabled:opacity-50"
                title="Save & Share"
            >
                {isSaving ? (
                    <span className="animate-spin h-4 w-4 border-2 border-gray-500 rounded-full border-t-transparent"></span>
                ) : (
                    <Icons.Share />
                )}
                <span>{designId ? "Update" : "Save"}</span>
            </button>
            <button 
                onClick={handleExport}
                disabled={isExporting} 
                className="flex items-center space-x-2 px-3 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
            >
                {isExporting ? (
                    <span className="animate-spin h-4 w-4 border-2 border-gray-500 rounded-full border-t-transparent border-t-white"></span>
                ) : (
                    <Icons.Download />
                )}
                <span>Download Gang Sheet</span>
            </button>
        </div>
      </div>
      
      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20 shadow-md">
            {/* Upload Area - Fixed Top */}
            <div className="p-4 border-b border-gray-200">
                <div 
                    className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-colors group"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={handleDrop}
                >
                    <span className="text-gray-400 group-hover:text-indigo-500 mb-3"><Icons.CloudUpload /></span>
                    <p className="text-sm font-medium text-gray-700 mb-1">Drag & drop files here</p>
                    <button className="mt-2 px-4 py-2 bg-gray-900 text-white text-xs font-medium rounded hover:bg-gray-800 transition-colors flex items-center space-x-2">
                        <Icons.CloudUpload />
                        <span>Upload</span>
                    </button>
                    <input type="file" ref={fileInputRef} hidden accept="image/*" multiple onChange={handleUploadImage} />
                </div>
            </div>

            {/* Gallery Area */}
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                 <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Uploaded Images</h3>
                 {uploadedFiles.length === 0 ? (
                     <p className="text-xs text-gray-400 text-center py-4">No images uploaded.</p>
                 ) : (
                     <div className="overflow-y-auto pr-1" style={{ maxHeight: '240px' }}>
                         <div className="grid grid-cols-4 gap-2">
                             {uploadedFiles.map(file => (
                                 <div 
                                     key={file.id} 
                                     className="group relative border rounded overflow-hidden bg-white cursor-pointer hover:border-indigo-500 hover:shadow-sm aspect-square flex items-center justify-center"
                                     onClick={() => addToCanvas(file)}
                                     title={file.name}
                                 >
                                     <img 
                                        src={file.src} 
                                        alt={file.name} 
                                        crossOrigin="anonymous" 
                                        loading="lazy" 
                                        decoding="async"
                                        className={`max-w-full max-h-full object-contain p-0.5 ${file.isUploading ? 'opacity-50' : ''}`} 
                                     />
                                     
                                     {file.isUploading && (
                                         <div className="absolute inset-0 flex items-center justify-center">
                                             <div className="w-4 h-4 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
                                         </div>
                                     )}

                                     {/* Add Overlay */}
                                     {!file.isUploading && (
                                         <div className="absolute inset-0 bg-indigo-500 bg-opacity-0 group-hover:bg-opacity-10 transition-all flex items-center justify-center pointer-events-none">
                                             <div className="opacity-0 group-hover:opacity-100 bg-white rounded-full p-1 shadow-sm text-indigo-600 scale-75">
                                                 <Icons.Plus />
                                             </div>
                                         </div>
                                     )}

                                     {/* Delete Button */}
                                     <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteUpload(file.id);
                                        }}
                                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-white hover:bg-red-50 text-red-500 rounded p-1 shadow-sm transition-all transform scale-75 z-10"
                                        title="Remove from uploads"
                                     >
                                        <Icons.Trash />
                                     </button>
                                 </div>
                             ))}
                         </div>
                     </div>
                 )}
            </div>

            {/* Properties Panel */}
            <div className="flex-1 overflow-y-auto p-4 bg-white">
                {selectedIds.length > 0 ? (
                    <div className="space-y-6">
                        {selectedIds.length > 1 ? (
                            <div className="text-center mt-4">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 mb-3">
                                    <Icons.Cursor />
                                </div>
                                <h3 className="text-sm font-bold text-gray-800 uppercase mb-1">{selectedIds.length} Items Selected</h3>
                                <p className="text-xs text-gray-500 mb-4">Edit shared properties.</p>
                                <div className="flex space-x-2 justify-center">
                                    <button 
                                        onClick={handleDuplicate}
                                        className="flex items-center space-x-1 text-indigo-600 hover:text-indigo-700 text-xs font-medium border border-indigo-200 rounded px-3 py-1 hover:bg-indigo-50"
                                    >
                                        <Icons.Copy />
                                        <span>Clone</span>
                                    </button>
                                    <button 
                                        onClick={handleDelete}
                                        className="flex items-center space-x-1 text-red-600 hover:text-red-700 text-xs font-medium border border-red-200 rounded px-3 py-1 hover:bg-red-50"
                                    >
                                        <Icons.Trash />
                                        <span>Delete</span>
                                    </button>
                                </div>
                            </div>
                        ) : selectedObject ? (
                            <>
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-gray-800 uppercase">Properties</h3>
                                    <div className="flex space-x-1">
                                        <button onClick={handleDuplicate} className="text-indigo-500 hover:text-indigo-700 p-1 hover:bg-indigo-50 rounded" title="Duplicate">
                                            <Icons.Copy />
                                        </button>
                                        <button onClick={() => deleteSingle(selectedObject.id)} className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded" title="Delete">
                                            <Icons.Trash />
                                        </button>
                                    </div>
                                </div>
                                <div className="bg-gray-100 rounded p-2 mb-4 flex justify-center">
                                    <img src={selectedObject.src} className="h-20 object-contain" alt="Selected" />
                                </div>
                                
                                <div className="space-y-4">
                                     <div>
                                         <label className="block text-xs font-medium text-gray-500 mb-2">Size (Inches)</label>
                                         <div className="grid grid-cols-2 gap-2">
                                             <div>
                                                <span className="text-xs text-gray-400">Width</span>
                                                <PropertyInput 
                                                    value={(selectedObject.width * selectedObject.scaleX) / PPI}
                                                    onChange={(val) => {
                                                        const newScaleX = (val * PPI) / selectedObject.width;
                                                        const ratio = selectedObject.scaleY / selectedObject.scaleX;
                                                        const newScaleY = newScaleX * ratio;
                                                        const newObjects = getUpdatedObjects(selectedObject.id, { scaleX: newScaleX, scaleY: newScaleY });
                                                        setObjects(newObjects); // Visual update only
                                                    }}
                                                    onCommit={() => {
                                                        saveHistory(objects); // Commit undo point
                                                    }}
                                                />
                                             </div>
                                             <div>
                                                <span className="text-xs text-gray-400">Height</span>
                                                <PropertyInput 
                                                    value={(selectedObject.height * selectedObject.scaleY) / PPI}
                                                    onChange={(val) => {
                                                        const newScaleY = (val * PPI) / selectedObject.height;
                                                        const ratio = selectedObject.scaleX / selectedObject.scaleY;
                                                        const newScaleX = newScaleY * ratio;
                                                        const newObjects = getUpdatedObjects(selectedObject.id, { scaleX: newScaleX, scaleY: newScaleY });
                                                        setObjects(newObjects); // Visual update only
                                                    }}
                                                    onCommit={() => {
                                                        saveHistory(objects); // Commit undo point
                                                    }}
                                                />
                                             </div>
                                         </div>
                                     </div>
                                </div>
                            </>
                        ) : null}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-60">
                        <Icons.Cursor />
                        <p className="text-xs mt-2">Select an item to edit</p>
                    </div>
                )}
            </div>
        </div>

        {/* Canvas Area */}
        <div 
          ref={containerRef}
          className={`flex-1 bg-gray-100 relative overflow-hidden ${isHandActive ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
            <div 
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: size.width,
                height: size.height,
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                transformOrigin: "center center",
                transition: "none"
              }}
              className="shadow-2xl"
            >
              <div className="checkerboard" style={{ width: size.width, height: size.height }}>
                <Stage
                  width={size.width}
                  height={size.height}
                  ref={stageRef}
                  onMouseDown={handleStageMouseDown}
                >
                  <Layer>
                    {objects.map((obj) => (
                      <URLImage
                        key={obj.id}
                        id={obj.id}
                        src={obj.src} // Thumbnail
                        x={obj.x}
                        y={obj.y}
                        width={obj.width}
                        height={obj.height}
                        scaleX={obj.scaleX}
                        scaleY={obj.scaleY}
                        rotation={obj.rotation}
                        activeTool={activeTool}
                        isSpacePressed={isSpacePressed}
                        isSelected={selectedIds.includes(obj.id)}
                        onClick={() => {}}
                        onDragStart={onDragStart}
                        onDragMove={onDragMove}
                        onDragEnd={onDragEnd}
                        onTransformStart={onTransformStart}
                        onTransformEnd={onTransformEnd}
                      />
                    ))}
                    <Transformer 
                        ref={transformerRef} 
                        enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                        boundBoxFunc={(oldBox, newBox) => {
                            if (newBox.width < 5 || newBox.height < 5) {
                                return oldBox;
                            }
                            return newBox;
                        }}
                    />
                    {selectionBox && (
                        <Rect
                            x={selectionBox.x}
                            y={selectionBox.y}
                            width={selectionBox.width}
                            height={selectionBox.height}
                            fill="rgba(0, 161, 255, 0.3)"
                            stroke="#00a1ff"
                            strokeWidth={1}
                        />
                    )}
                  </Layer>
                </Stage>
              </div>
            </div>
            <div className="absolute bottom-6 bg-white rounded-lg shadow-lg flex items-center p-1 space-x-2 border border-gray-200 left-1/2 transform -translate-x-1/2">
                <button onClick={undo} disabled={historyStep === 0} className="p-2 hover:bg-gray-100 rounded disabled:opacity-50">
                    <Icons.Undo />
                </button>
                <button onClick={redo} disabled={historyStep === history.length - 1} className="p-2 hover:bg-gray-100 rounded disabled:opacity-50">
                    <Icons.Redo />
                </button>
                <div className="h-4 w-px bg-gray-300"></div>
                <button onClick={() => setZoom(Math.max(MIN_ZOOM, zoom - 0.1))} className="p-2 hover:bg-gray-100 rounded">
                    <Icons.Minus />
                </button>
                <span className="text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(Math.min(MAX_ZOOM, zoom + 0.1))} className="p-2 hover:bg-gray-100 rounded">
                    <Icons.Plus />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;