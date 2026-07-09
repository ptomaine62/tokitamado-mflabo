from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any

MAX_HP = 30
MAX_TP = 10
MAX_CHARGE = 10

PHASE_WAITING = "WAITING"
PHASE_READY = "READY"
PHASE_ATTACK_SELECT = "ATTACK_SELECT"
PHASE_DEFENSE_SELECT = "DEFENSE_SELECT"
PHASE_REVEAL = "REVEAL"
PHASE_RESOLVE = "RESOLVE"
PHASE_COUNTDOWN = "COUNTDOWN"
PHASE_CONTINUOUS = "CONTINUOUS"
PHASE_GAME_OVER = "GAME_OVER"
PHASE_PANIC = "PANIC"


@dataclass
class PlayerState:
    player_id: str
    display_name: str = "Player"
    hp: int = MAX_HP
    tp: int = 3
    charge: int = 0
    next_attack_bonus: int = 0
    ready: bool = False
    locked: bool = False
    selected_card_id: str | None = None
    role: str = "spectator"
    connected: bool = False


@dataclass(frozen=True)
class CardDef:
    card_id: str
    name: str
    card_type: str
    self_effect: str
    opponent_effect: str
    condition: str = "なし"
    recoil: str = "なし"
    cost_tp: int = 0

    def to_dict(self, actor: PlayerState | None = None) -> dict[str, Any]:
        playable = True
        disabled_reason = ""
        if actor is not None and self.card_type == "attack" and actor.tp < self.cost_tp:
            playable = False
            disabled_reason = f"自分 TP が {self.cost_tp} 未満です"
        return {
            "card_id": self.card_id,
            "name": self.name,
            "card_type": self.card_type,
            "self_effect": self.self_effect,
            "opponent_effect": self.opponent_effect,
            "condition": self.condition,
            "recoil": self.recoil,
            "cost_tp": self.cost_tp,
            "playable": playable,
            "disabled_reason": disabled_reason,
        }


@dataclass
class TurnResult:
    attack_card: CardDef
    defense_card: CardDef
    attacker_id: str
    defender_id: str
    hp_damage: int
    counter_damage: int
    evaded: bool
    counter_success: bool
    logs: list[str]
    continuous_state: dict[str, Any]
    winner: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "attack_card": self.attack_card.to_dict(),
            "defense_card": self.defense_card.to_dict(),
            "attacker_id": self.attacker_id,
            "defender_id": self.defender_id,
            "hp_damage": self.hp_damage,
            "counter_damage": self.counter_damage,
            "evaded": self.evaded,
            "counter_success": self.counter_success,
            "logs": self.logs,
            "continuous_state": self.continuous_state,
            "winner": self.winner,
        }


@dataclass
class GameState:
    room_id: str
    phase: str = PHASE_WAITING
    players: dict[str, PlayerState] = field(default_factory=lambda: {
        "p1": PlayerState("p1", "P1", role="p1"),
        "p2": PlayerState("p2", "P2", role="p2"),
    })
    attacker_id: str = "p1"
    defender_id: str = "p2"
    attack_hand: list[CardDef] = field(default_factory=list)
    defense_hand: list[CardDef] = field(default_factory=list)
    attack_choice: str | None = None
    defense_choice: str | None = None
    turn_no: int = 1
    logs: list[str] = field(default_factory=list)
    last_result: dict[str, Any] | None = None
    continuous_state: dict[str, Any] | None = None
    panic_reason: str | None = None
    give_up: dict[str, bool] = field(default_factory=lambda: {"p1": False, "p2": False})
    winner: str | None = None


ATTACK_CARDS = [
    CardDef("attack_basic", "たたかう", "attack", "自分への効果: なし", "相手 🟥HP -1〜3 / 相手 ⚡帯電 +1", "なし", "なし", 0),
    CardDef("attack_heavy", "強攻撃", "attack", "自分 🟣TP -3", "相手 🟥HP -5〜7 / 相手 ⚡帯電 +2", "自分 TP >= 3", "なし", 3),
    CardDef("attack_charge", "ためる", "attack", "自分 🟣TP +3 / 自分 次の攻撃 +2", "相手への効果: なし", "なし", "なし", 0),
    CardDef("attack_break", "ガードくずし", "attack", "自分 🟣TP -2", "通常: 相手 🟥HP -1〜2 / 相手がぼうぎょ: 相手 🟥HP -5〜7・相手 ⚡帯電 +2", "自分 TP >= 2", "なし", 2),
    CardDef("attack_desperate", "捨て身", "attack", "自分 🟣TP -4", "相手 🟥HP -6〜8 / 相手 ⚡帯電 +2", "自分 TP >= 4", "自分 ⚡帯電 +2", 4),
    CardDef("attack_resonance", "共鳴撃", "attack", "自分 🟣TP -3 / 自分 ⚡帯電 +1", "相手 🟥HP -4〜6 / 相手 ⚡帯電 +2 / 自分の帯電7以上なら相手 🟥HPさらに-2", "自分 TP >= 3", "なし", 3),
]

DEFENSE_CARDS = [
    CardDef("def_receive", "受ける", "defense", "自分 🟣TP +2", "相手の攻撃はそのまま受ける", "なし", "なし"),
    CardDef("def_guard", "ぼうぎょ", "defense", "自分 🟣TP +1", "相手の攻撃ダメージを半減", "なし", "なし"),
    CardDef("def_evade", "みかわし", "defense", "成功時: 自分が受ける攻撃ダメージ0・帯電上昇0", "相手が強攻撃または捨て身なら成功 / 相手自身の反動は残る", "相手の攻撃カードが強攻撃または捨て身", "なし"),
    CardDef("def_endure", "がまん", "defense", "自分が受ける攻撃ダメージ -2 / 自分 ⚡帯電 -2 / 自分 🟣TP +1", "相手への効果: なし", "なし", "なし"),
    CardDef("def_counter", "カウンター", "defense", "成功時: 自分が受ける攻撃ダメージ半減", "成功時: 相手 🟥HP -3〜5", "相手の攻撃カードが強攻撃または捨て身", "なし"),
    CardDef("def_recover", "立て直す", "defense", "自分 🟥HP +1 / 自分 ⚡帯電 -3 / 自分 🟣TP +1", "相手の攻撃は受ける", "なし", "なし"),
]


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


class GameEngine:
    def __init__(self, room_id: str):
        self.state = self.create_game(room_id)

    def create_game(self, room_id: str) -> GameState:
        return GameState(room_id=room_id)

    def reset_game(self) -> None:
        room_id = self.state.room_id
        old_names = {pid: p.display_name for pid, p in self.state.players.items()}
        old_connected = {pid: p.connected for pid, p in self.state.players.items()}
        self.state = self.create_game(room_id)
        for pid, name in old_names.items():
            self.state.players[pid].display_name = name
            self.state.players[pid].connected = old_connected.get(pid, False)
        self.state.logs.append("ゲームをリセットしました。")
        self._maybe_enter_ready()

    def set_player_connected(self, player_id: str, display_name: str, connected: bool = True) -> None:
        if player_id in self.state.players:
            p = self.state.players[player_id]
            p.display_name = display_name or player_id.upper()
            p.connected = connected
            p.ready = False if not connected else p.ready
            p.locked = False if not connected else p.locked
            if not connected and self.state.phase not in {PHASE_GAME_OVER, PHASE_PANIC}:
                self.state.phase = PHASE_WAITING

    def set_ready(self, player_id: str, ready: bool = True) -> None:
        self._require_player(player_id).ready = ready
        self._maybe_enter_ready()

    def _maybe_enter_ready(self) -> None:
        if all(p.connected for p in self.state.players.values()):
            if all(p.ready for p in self.state.players.values()):
                self.state.phase = PHASE_READY
                self.start_turn()
            elif self.state.phase == PHASE_WAITING:
                self.state.logs.append("P1/P2 が揃いました。Readyを待っています。")
        else:
            self.state.phase = PHASE_WAITING

    def start_turn(self) -> None:
        if self.state.phase in {PHASE_PANIC, PHASE_GAME_OVER}:
            return
        self.state.attack_choice = None
        self.state.defense_choice = None
        for p in self.state.players.values():
            p.locked = False
            p.selected_card_id = None
        self.state.attack_hand = self.draw_attack_hand(self.state.attacker_id)
        self.state.defense_hand = self.draw_defense_hand(self.state.defender_id)
        self.state.phase = PHASE_ATTACK_SELECT
        self.state.logs.append(f"Turn {self.state.turn_no}: {self.state.attacker_id.upper()} が攻撃、{self.state.defender_id.upper()} が受けです。")

    def draw_attack_hand(self, player_id: str) -> list[CardDef]:
        player = self._require_player(player_id)
        hand = random.sample(ATTACK_CARDS, 3)
        if all(player.tp < card.cost_tp for card in hand):
            hand[0] = self.get_card("attack_basic")
        return hand

    def draw_defense_hand(self, player_id: str) -> list[CardDef]:
        self._require_player(player_id)
        return random.sample(DEFENSE_CARDS, 3)

    def choose_card(self, player_id: str, card_id: str) -> None:
        if self.state.phase not in {PHASE_ATTACK_SELECT, PHASE_DEFENSE_SELECT}:
            raise ValueError("現在はカード選択フェーズではありません。")
        if player_id == self.state.attacker_id:
            card = self._find_in_hand(card_id, self.state.attack_hand)
            actor = self._require_player(player_id)
            if actor.tp < card.cost_tp:
                raise ValueError("TP不足でこの攻撃カードは選択できません。")
            self.state.attack_choice = card_id
            actor.locked = True
            actor.selected_card_id = card_id
        elif player_id == self.state.defender_id:
            card = self._find_in_hand(card_id, self.state.defense_hand)
            actor = self._require_player(player_id)
            self.state.defense_choice = card.card_id
            actor.locked = True
            actor.selected_card_id = card.card_id
        else:
            raise ValueError("観戦者はカード選択できません。")
        if self.state.attack_choice and not self.state.defense_choice:
            self.state.phase = PHASE_DEFENSE_SELECT
        if self.state.attack_choice and self.state.defense_choice:
            self.state.phase = PHASE_REVEAL

    def resolve_turn(self) -> TurnResult:
        if not self.state.attack_choice or not self.state.defense_choice:
            raise ValueError("両者のカードが選択されていません。")
        self.state.phase = PHASE_RESOLVE
        attacker = self._require_player(self.state.attacker_id)
        defender = self._require_player(self.state.defender_id)
        attack = self.get_card(self.state.attack_choice)
        defense = self.get_card(self.state.defense_choice)
        logs: list[str] = [f"{attacker.display_name} は {attack.name}、{defender.display_name} は {defense.name} を公開。"]
        damage, charge_to_defender, recoil_charge, counter_damage, evaded, counter_success = self._build_attack_effect(attack, defense, attacker)
        if damage > 0:
            damage += attacker.next_attack_bonus
            if attacker.next_attack_bonus:
                logs.append(f"次の攻撃ボーナス +{attacker.next_attack_bonus} を適用。")
        if attack.card_id.startswith("attack_"):
            attacker.next_attack_bonus = 0
        damage, charge_to_defender, counter_damage, evaded, counter_success = self._apply_defense_effect(defense, attack, damage, charge_to_defender, counter_damage, evaded, counter_success, logs)
        if damage > 0 and not evaded:
            bonus = 2 if defender.charge >= 10 else 1 if defender.charge >= 7 else 0
            if bonus:
                damage += bonus
                logs.append(f"{defender.display_name} の帯電により被ダメージ +{bonus}。")
        self._apply_cost_and_special(attack, defense, attacker, defender, damage, charge_to_defender, recoil_charge, counter_damage, logs)
        winner = None
        if defender.hp <= 0 and attacker.hp <= 0:
            winner = "draw"
        elif defender.hp <= 0:
            winner = attacker.player_id
        elif attacker.hp <= 0:
            winner = defender.player_id
        continuous = self._make_continuous_state(damage, defense, counter_success, defender.player_id)
        result = TurnResult(attack, defense, attacker.player_id, defender.player_id, damage, counter_damage, evaded, counter_success, logs, continuous, winner)
        self.state.last_result = result.to_dict()
        self.state.continuous_state = continuous
        self.state.logs.extend(logs)
        self.state.phase = PHASE_GAME_OVER if winner else PHASE_COUNTDOWN
        self.state.winner = winner
        if not winner:
            self.state.attacker_id, self.state.defender_id = self.state.defender_id, self.state.attacker_id
            self.state.turn_no += 1
        return result

    def enter_continuous(self) -> dict[str, Any]:
        self.state.phase = PHASE_CONTINUOUS
        return self.state.continuous_state or {"pattern": "calm", "intensity_hint": 0, "duration_sec": 8, "target": self.state.defender_id, "label": "静穏"}

    def finish_continuous_and_next(self) -> None:
        if self.state.phase != PHASE_GAME_OVER:
            self.start_turn()

    def panic_stop(self, reason: str = "panic") -> dict[str, Any]:
        self.state.phase = PHASE_PANIC
        self.state.panic_reason = reason
        self.state.continuous_state = {"pattern": "stop", "intensity_hint": 0, "duration_sec": 0, "target": "all", "label": "Panic / Stop"}
        self.state.logs.append(f"Panic / Stop: {reason}")
        return self.state.continuous_state

    def set_give_up(self, player_id: str, active: bool) -> None:
        if player_id in self.state.give_up:
            self.state.give_up[player_id] = active
            self.state.logs.append(f"{player_id.upper()} Give Up {'開始' if active else '解除'}")

    def to_public_state(self) -> dict[str, Any]:
        def player_dict(p: PlayerState) -> dict[str, Any]:
            return {
                "player_id": p.player_id,
                "display_name": p.display_name,
                "hp": p.hp,
                "max_hp": MAX_HP,
                "tp": p.tp,
                "max_tp": MAX_TP,
                "charge": p.charge,
                "max_charge": MAX_CHARGE,
                "next_attack_bonus": p.next_attack_bonus,
                "ready": p.ready,
                "locked": p.locked,
                "connected": p.connected,
            }
        return {
            "room_id": self.state.room_id,
            "phase": self.state.phase,
            "players": {pid: player_dict(p) for pid, p in self.state.players.items()},
            "attacker_id": self.state.attacker_id,
            "defender_id": self.state.defender_id,
            "turn_no": self.state.turn_no,
            "logs": self.state.logs[-80:],
            "last_result": self.state.last_result,
            "continuous_state": self.state.continuous_state,
            "panic_reason": self.state.panic_reason,
            "give_up": self.state.give_up,
            "winner": self.state.winner,
        }

    def hand_for(self, player_id: str) -> list[dict[str, Any]]:
        if player_id == self.state.attacker_id:
            actor = self._require_player(player_id)
            return [card.to_dict(actor) for card in self.state.attack_hand]
        if player_id == self.state.defender_id:
            actor = self._require_player(player_id)
            return [card.to_dict(actor) for card in self.state.defense_hand]
        return []

    def get_card(self, card_id: str) -> CardDef:
        for card in ATTACK_CARDS + DEFENSE_CARDS:
            if card.card_id == card_id:
                return card
        raise ValueError(f"Unknown card: {card_id}")

    def _require_player(self, player_id: str) -> PlayerState:
        if player_id not in self.state.players:
            raise ValueError("Unknown player")
        return self.state.players[player_id]

    def _find_in_hand(self, card_id: str, hand: list[CardDef]) -> CardDef:
        for card in hand:
            if card.card_id == card_id:
                return card
        raise ValueError("このカードは現在の手札にありません。")

    def _build_attack_effect(self, attack: CardDef, defense: CardDef, attacker: PlayerState) -> tuple[int, int, int, int, bool, bool]:
        damage = charge_to_defender = recoil_charge = counter_damage = 0
        if attack.card_id == "attack_basic":
            damage, charge_to_defender = random.randint(1, 3), 1
        elif attack.card_id == "attack_heavy":
            damage, charge_to_defender = random.randint(5, 7), 2
        elif attack.card_id == "attack_charge":
            damage = 0
        elif attack.card_id == "attack_break":
            if defense.card_id == "def_guard":
                damage, charge_to_defender = random.randint(5, 7), 2
            else:
                damage = random.randint(1, 2)
        elif attack.card_id == "attack_desperate":
            damage, charge_to_defender, recoil_charge = random.randint(6, 8), 2, 2
        elif attack.card_id == "attack_resonance":
            damage, charge_to_defender = random.randint(4, 6), 2
            if attacker.charge >= 7:
                damage += 2
        return damage, charge_to_defender, recoil_charge, counter_damage, False, False

    def _apply_defense_effect(self, defense: CardDef, attack: CardDef, damage: int, charge_to_defender: int, counter_damage: int, evaded: bool, counter_success: bool, logs: list[str]) -> tuple[int, int, int, bool, bool]:
        if defense.card_id == "def_guard":
            damage = math.ceil(damage / 2)
            logs.append("ぼうぎょで攻撃ダメージを半減。")
        elif defense.card_id == "def_evade" and attack.card_id in {"attack_heavy", "attack_desperate"}:
            damage, charge_to_defender, evaded = 0, 0, True
            logs.append("みかわし成功。攻撃ダメージと相手からの帯電上昇を0にしました。")
        elif defense.card_id == "def_endure":
            damage = max(0, damage - 2)
            logs.append("がまんで攻撃ダメージを2軽減。")
        elif defense.card_id == "def_counter" and attack.card_id in {"attack_heavy", "attack_desperate"}:
            damage = math.ceil(damage / 2)
            counter_damage, counter_success = random.randint(3, 5), True
            logs.append(f"カウンター成功。反撃 {counter_damage} ダメージ。")
        return damage, charge_to_defender, counter_damage, evaded, counter_success

    def _apply_cost_and_special(self, attack: CardDef, defense: CardDef, attacker: PlayerState, defender: PlayerState, damage: int, charge_to_defender: int, recoil_charge: int, counter_damage: int, logs: list[str]) -> None:
        attacker.tp -= attack.cost_tp
        if attack.card_id == "attack_charge":
            attacker.tp += 3
            attacker.next_attack_bonus += 2
            logs.append("ためるで TP +3、次の攻撃 +2。")
        if attack.card_id == "attack_resonance":
            attacker.charge += 1
        defender.hp -= damage
        defender.charge += charge_to_defender
        attacker.charge += recoil_charge
        attacker.hp -= counter_damage
        if defense.card_id == "def_receive":
            defender.tp += 2
        elif defense.card_id == "def_guard":
            defender.tp += 1
        elif defense.card_id == "def_endure":
            defender.charge -= 2
            defender.tp += 1
        elif defense.card_id == "def_recover":
            defender.hp += 1
            defender.charge -= 3
            defender.tp += 1
            logs.append("立て直すで HP +1、帯電 -3、TP +1。")
        for p in (attacker, defender):
            p.hp = clamp(p.hp, 0, MAX_HP)
            p.tp = clamp(p.tp, 0, MAX_TP)
            p.charge = clamp(p.charge, 0, MAX_CHARGE)

    def _make_continuous_state(self, damage: int, defense: CardDef, counter_success: bool, target: str) -> dict[str, Any]:
        if counter_success:
            pattern, label = "counter", "カウンター成功"
        elif defense.card_id == "def_recover":
            pattern, label = "recover", "立て直し"
        elif damage == 0:
            pattern, label = "calm", "ノーダメージ"
        elif damage <= 3:
            pattern, label = "pulse", "軽いヒット"
        elif damage <= 6:
            pattern, label = "pressure", "強いヒット"
        else:
            pattern, label = "burst", "大ダメージ"
        return {"pattern": pattern, "intensity_hint": clamp(damage * 12, 0, 100), "duration_sec": 8, "target": target, "label": label}
