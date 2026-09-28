export type Role = 'gm' | 'player';
export type Field = {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'resource';
  value: string | number;
  max?: number;
};
export type Ability = { id: string; name: string; description: string; expression: string };
export type Section = { id: string; title: string; fields: Field[]; abilities: Ability[] };
export type Sheet = { version: 1; sections: Section[] };
export type Actor = {
  id: string;
  game_id: string;
  name: string;
  kind: 'character' | 'npc' | 'enemy';
  owner_id: string;
  sheet: Sheet;
  revision: number;
};
export type Game = {
  id: string;
  name: string;
  gm_id: string;
  active_scene_id: string | null;
  dice: number[];
};
export type Scene = {
  id: string;
  game_id: string;
  name: string;
  asset_id: string;
  width: number;
  height: number;
  units_per_pixel: number;
  unit: string;
  fog: FogRect[];
  revision: number;
};
export type FogRect = { x: number; y: number; width: number; height: number; reveal: boolean };
export type Token = {
  id: string;
  game_id: string;
  scene_id: string;
  actor_id: string;
  label: string;
  controller_id: string;
  asset_id: string | null;
  x: number;
  y: number;
  size: number;
  hidden: boolean;
  revision: number;
};
export type Member = { user_id: string; role: Role; display_name: string };
export type Grant = { actor_id: string; user_id: string; can_edit: boolean };
export type Template = {
  id: string;
  game_id: string;
  creator_id: string;
  name: string;
  sheet: Sheet;
};
export type DieResult = { sides: number; values: number[]; kept: boolean[]; total: number };
export type RollResult = {
  total: number;
  dice: DieResult[];
  resolvedExpression: string;
  modifiers: Record<string, number>;
};
export type Roll = {
  id: string;
  game_id: string;
  author_id: string;
  author_name: string;
  actor_id: string | null;
  expression: string;
  visibility: 'public' | 'private';
  result: RollResult;
  created_at: string;
};
export type Snapshot = {
  game: Game;
  role: Role;
  userId: string;
  members: Member[];
  actors: Actor[];
  scenes: Scene[];
  tokens: Token[];
  grants: Grant[];
  templates: Template[];
  rolls: Roll[];
};
