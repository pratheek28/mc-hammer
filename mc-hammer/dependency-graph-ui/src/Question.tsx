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
  expandedOptionId,
  onSelectOption,
  onToggleMore,
  onConfirm,
}: QuestionProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose conflict resolution">
      <div className="resolution-modal">
        <h2 className="resolution-title">{question}</h2>
        <div className="resolution-options">
          {options.map((option) => {
            const isSelected = selectedOptionId === option.id;
            const isExpanded = expandedOptionId === option.id;
            return (
              <div key={option.id} className={`resolution-option ${isSelected ? "selected" : ""}`}>
                <button type="button" className="option-select" onClick={() => onSelectOption(option.id)}>
                  {option.summary}
                </button>
                <button type="button" className="option-more" onClick={() => onToggleMore(option.id)}>
                  More
                </button>
                {isExpanded && <div className="option-details">{option.details}</div>}
              </div>
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
