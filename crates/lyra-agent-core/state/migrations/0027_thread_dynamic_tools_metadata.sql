ALTER TABLE thread_dynamic_tools
ADD COLUMN namespace TEXT;

ALTER TABLE thread_dynamic_tools
ADD COLUMN side_effects TEXT;

ALTER TABLE thread_dynamic_tools
ADD COLUMN approval_mode TEXT;

ALTER TABLE thread_dynamic_tools
ADD COLUMN risk TEXT;

ALTER TABLE thread_dynamic_tools
ADD COLUMN model_input_capabilities TEXT;
