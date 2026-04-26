export type ResolutionOption = {
  id: string;
  summary: string;
  details: string;
};

type QuestionProps = {
  isVisible: boolean;
  question: string;
  options: ResolutionOption[];
  selectedOptionId: string | null;
  expandedOptionId: string | null;
  onSelectOption: (optionId: string) => void;
  onToggleMore: (optionId: string) => void;
  onConfirm: () => void;
};

export default function Question({
  isVisible,
  question,
  options,
  selectedOptionId,
  expandedOptionId: _expandedOptionId,
  onSelectOption,
  onToggleMore: _onToggleMore,
  onConfirm,
}: QuestionProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Choose conflict resolution"
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="resolution-modal">
        <h2 className="resolution-title">{question}</h2>
        <div className="resolution-options">
          {options.map((option) => {
            const isSelected = selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`resolution-option ${isSelected ? "selected" : ""}`}
                onClick={() => onSelectOption(option.id)}
              >
                <div className="option-title">{option.summary}</div>
                <div className="option-description">{option.details}</div>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="confirm-button" disabled={!selectedOptionId} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}